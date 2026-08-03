import { fromDialectType, type Dialect } from './dialect.js'
import type { ProjectModel } from './model.js'
import { restoreLogicalName, type NamingRules } from './naming.js'
import type { ParsedDdl, ParsedTable, ParsedConstraint } from './ddl-parse.js'

export type DdlImportWarning = {
  kind: 'ambiguous-type' | 'unknown-type' | 'unknown-word'
      | 'table-conflict' | 'unresolved-fk' | 'unresolved-index' | 'skipped-statement'
  target: string
  message: string
}
export type DdlImportColumn = {
  physicalName: string; logicalName: string; type: string
  isPk: boolean; nullable: boolean; autoIncrement: boolean
  defaultValue: string | null; comment: string | null
}
export type DdlImportTable = {
  physicalName: string; logicalName: string; comment: string | null
  columns: DdlImportColumn[]
  indexes: Array<{ name: string; columnPhysicalNames: string[]; unique: boolean }>
}
export type DdlImportRelationship = {
  childPhysicalName: string; parentPhysicalName: string
  columnPairs: Array<{ child: string; parent: string }>
  identifying: boolean
}
export type DdlImportPlan = {
  tables: DdlImportTable[]
  relationships: DdlImportRelationship[]
  skippedTables: string[]
  warnings: DdlImportWarning[]
  opCountEstimate: number
}

/** commentText의 역 — 첫 ' - '에서 한 번만 쪼갠다. */
function splitComment(text: string): { logicalName: string; comment: string | null } {
  const i = text.indexOf(' - ')
  if (i < 0) return { logicalName: text.trim(), comment: null }
  return { logicalName: text.slice(0, i).trim(), comment: text.slice(i + 3).trim() || null }
}

const upper = (s: string) => s.trim().toUpperCase()
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set(a.map(upper)).size === new Set([...a, ...b].map(upper)).size
/** a의 모든 원소가 b에 있으면 true(부분집합, 순서 무시). identifying 판정에 쓴다 — 자식
 * PK가 FK보다 넓은 합성키(예: (MBR_NO, ROLE_CD))인 식별 관계에서는 sameSet(길이까지 같아야
 * 함)이 아니라 부분집합 검사가 맞다. */
const isSubset = (a: string[], b: string[]) => {
  const bSet = new Set(b.map(upper))
  return a.length > 0 && a.every((x) => bSet.has(upper(x)))
}

export function planDdlImport(
  model: ProjectModel, parsed: ParsedDdl, dialect: Dialect, rules: NamingRules,
): DdlImportPlan {
  const warnings: DdlImportWarning[] = []

  // 1) 이름 충돌 판정 — 살아남은 테이블만 alive에 남는다. 모델의 기존 테이블과 겹치는
  // 경우뿐 아니라(I-2c) DDL 안에서 같은 이름의 CREATE TABLE이 두 번 오는 경우도 뒤엣것을
  // 건너뛴다 — 그렇지 않으면 alive.set이 조용히 덮어써 앞 테이블의 컬럼이 소리 없이 사라진다.
  const existing = new Set(Object.values(model.tables).map((t) => upper(t.physicalName)))
  const skippedTables: string[] = []
  const alive = new Map<string, ParsedTable>()
  for (const t of parsed.tables) {
    const key = upper(t.name)
    if (existing.has(key)) {
      skippedTables.push(t.name)
      warnings.push({ kind: 'table-conflict', target: t.name, message: '같은 이름의 테이블이 이미 있어 건너뜁니다' })
      continue
    }
    if (alive.has(key)) {
      warnings.push({
        kind: 'table-conflict', target: t.name,
        message: 'DDL에 같은 이름의 테이블이 두 번 있어 뒤엣것을 건너뜁니다',
      })
      continue
    }
    alive.set(key, t)
  }

  // 2) 제약 색인 — PK는 먼저 나온 것을 쓴다(인라인 + 테이블 수준 중복 방지)
  const pkOf = new Map<string, string[]>()
  const fks: Array<Extract<ParsedConstraint, { kind: 'fk' }>> = []
  const uniques: Array<Extract<ParsedConstraint, { kind: 'unique' }>> = []
  for (const c of parsed.constraints) {
    if (c.kind === 'pk') { if (!pkOf.has(upper(c.table))) pkOf.set(upper(c.table), c.columns) }
    else if (c.kind === 'fk') fks.push(c)
    else uniques.push(c)
  }

  // 3) 코멘트 색인
  const tableComment = new Map<string, string>()
  const columnComment = new Map<string, string>()
  for (const c of parsed.comments) {
    if (c.column === null) tableComment.set(upper(c.table), c.text)
    else columnComment.set(`${upper(c.table)}.${upper(c.column)}`, c.text)
  }

  /** 코멘트 → 사전 → 물리명. target은 경고에 쓸 이름이다. */
  const resolveName = (
    physicalName: string, comment: string | undefined, target: string,
  ): { logicalName: string; comment: string | null } => {
    if (comment !== undefined && comment.trim() !== '') return splitComment(comment)
    const restored = restoreLogicalName(physicalName, model.words, model.terms, rules)
    if (restored.ok) return { logicalName: restored.logicalName, comment: null }
    warnings.push({
      kind: 'unknown-word', target,
      message: `논리명을 복원하지 못했습니다 — 사전에 없는 단어: ${restored.unknownTokens.join(', ')}`,
    })
    return { logicalName: physicalName, comment: null }
  }

  // 4) 테이블·컬럼 변환. 컬럼 물리명 정규화 맵(대문자 → 실제 물리명)도 함께 만든다 — 인덱스·
  // 관계가 DDL 원문 표기(대소문자·부모 PK 표기 등)를 실제 컬럼으로 해소하는 데 쓴다(I-3).
  const tables: DdlImportTable[] = []
  const colMapByTable = new Map<string, Map<string, string>>()
  for (const t of alive.values()) {
    const pkCols = new Set((pkOf.get(upper(t.name)) ?? []).map(upper))
    const named = resolveName(t.name, tableComment.get(upper(t.name)), t.name)
    const colMap = new Map<string, string>()
    const columns: DdlImportColumn[] = t.columns.map((c) => {
      colMap.set(upper(c.name), c.name)
      const target = `${t.name}.${c.name}`
      const mapped = fromDialectType(c.rawType, dialect)
      let type: string
      if (!mapped.ok) {
        type = mapped.raw
        warnings.push({ kind: 'unknown-type', target, message: `${mapped.raw}를 알지 못해 타입을 그대로 두었습니다` })
      } else {
        type = mapped.canonical
        if (mapped.alternatives.length > 0) {
          warnings.push({
            kind: 'ambiguous-type', target,
            message: `${c.rawType}을 ${mapped.canonical}로 읽었습니다 (${mapped.alternatives.join(', ')}일 수 있습니다)`,
          })
        }
      }
      const isPk = pkCols.has(upper(c.name)) || c.inlinePk
      // 코멘트 출처는 COMMENT ON COLUMN(parsed.comments, postgres/oracle)이 먼저다. 그것이
      // 없을 때만 MySQL 인라인 COMMENT(c.comment)를 쓴다 — 한 컬럼에 둘 다 있을 일은 없다
      // (방언마다 코멘트 표현 방식이 다르므로). c.comment도 논리명 복원 대상이다(§5) —
      // 방언 이름만 다를 뿐 "코멘트가 논리명을 담는다"는 규칙은 동일해야 한다.
      const rawComment = columnComment.get(`${upper(t.name)}.${upper(c.name)}`) ?? c.comment ?? undefined
      const colNamed = resolveName(c.name, rawComment, target)
      return {
        physicalName: c.name, logicalName: colNamed.logicalName, type,
        isPk, nullable: !c.notNull && !isPk, autoIncrement: c.autoIncrement,
        defaultValue: c.defaultValue, comment: colNamed.comment,
      }
    })

    colMapByTable.set(upper(t.name), colMap)
    tables.push({
      physicalName: t.name, logicalName: named.logicalName, comment: named.comment,
      columns, indexes: [],
    })
  }
  const tableByUpper = new Map(tables.map((t) => [upper(t.physicalName), t]))

  /** rawCols를 그 테이블의 실제 컬럼 물리명으로 정규화한다. 하나라도 없으면 첫 실패 컬럼명을 돌려준다. */
  const resolveIndexColumns = (
    tableKey: string, rawCols: string[],
  ): { names: string[] } | { missing: string } => {
    const colMap = colMapByTable.get(tableKey)!
    const names: string[] = []
    for (const raw of rawCols) {
      const hit = colMap.get(upper(raw))
      if (hit === undefined) return { missing: raw }
      names.push(hit)
    }
    return { names }
  }

  // 5) 인덱스 — CREATE INDEX 전부를 훑는다(테이블별 필터가 아니라). alive 테이블에 속하지
  // 않는 인덱스(I-2b: 이름 충돌로 건너뛴 테이블, CREATE TABLE 없이 CREATE INDEX만 온 경우)를
  // 조용히 버리지 않고 경고한다. 컬럼은 실제 물리명으로 정규화하고(I-3) — 대소문자 불일치,
  // 함수·표현식 인덱스, 파싱 범위 밖에서 추가된 컬럼처럼 해소되지 않는 경우 인덱스를 만들지
  // 않고 경고한다. PK와 컬럼이 정확히 같은 유니크 인덱스는 여전히 조용히 제외한다.
  for (const ix of parsed.indexes) {
    const tableKey = upper(ix.table)
    const table = tableByUpper.get(tableKey)
    if (!table) {
      warnings.push({
        kind: 'unresolved-index', target: `${ix.table}.${ix.name}`,
        message: `소속 테이블을 찾지 못해 인덱스 ${ix.name}을 만들지 않았습니다`,
      })
      continue
    }
    const pkList = pkOf.get(tableKey) ?? []
    if (ix.unique && pkList.length > 0 && sameSet(ix.columns, pkList)) continue
    const resolved = resolveIndexColumns(tableKey, ix.columns)
    if ('missing' in resolved) {
      warnings.push({
        kind: 'unresolved-index', target: `${table.physicalName}.${ix.name}`,
        message: `컬럼 ${resolved.missing}을 찾지 못해 인덱스 ${ix.name}을 만들지 않았습니다`,
      })
      continue
    }
    table.indexes.push({ name: ix.name, columnPhysicalNames: resolved.names, unique: ix.unique })
  }

  // UNIQUE 제약도 유니크 인덱스로 합류시킨다(I-2a) — 우리 자신의 내보내기도 1:1 관계에서
  // ALTER TABLE ... ADD CONSTRAINT ... UNIQUE 형태를 낼 수 있어 왕복에도 구멍이었다.
  // PK와 컬럼이 같은 UNIQUE는 앞의 인덱스와 같은 규칙으로 조용히 제외한다(PK를 뒷받침하는
  // UNIQUE가 함께 오는 것은 흔하다). 이름이 없으면 테이블 안에서 유일한 이름을 만든다.
  const usedIndexNames = new Map<string, Set<string>>()
  for (const t of tables) usedIndexNames.set(upper(t.physicalName), new Set(t.indexes.map((ix) => ix.name)))
  for (const u of uniques) {
    const tableKey = upper(u.table)
    const table = tableByUpper.get(tableKey)
    if (!table) {
      // ALTER TABLE ... ADD CONSTRAINT ... UNIQUE는 CREATE TABLE이 없는 이름도 가리킬 수 있다
      // (오타·이름 충돌로 건너뛴 테이블·DDL 밖의 테이블). 인덱스와 같은 결함 클래스이므로
      // 같은 규칙으로 경고한다.
      warnings.push({
        kind: 'unresolved-index', target: `${u.table}.${u.name ?? 'UNIQUE'}`,
        message: `소속 테이블을 찾지 못해 UNIQUE 제약을 인덱스로 만들지 않았습니다`,
      })
      continue
    }
    const pkList = pkOf.get(tableKey) ?? []
    if (pkList.length > 0 && sameSet(u.columns, pkList)) continue
    const resolved = resolveIndexColumns(tableKey, u.columns)
    if ('missing' in resolved) {
      warnings.push({
        kind: 'unresolved-index', target: `${table.physicalName}.${u.name ?? 'UNIQUE'}`,
        message: `컬럼 ${resolved.missing}을 찾지 못해 UNIQUE 제약을 인덱스로 만들지 않았습니다`,
      })
      continue
    }
    const used = usedIndexNames.get(tableKey)!
    let name = u.name
    if (name === null) {
      let n = 1
      while (used.has(`UX_${table.physicalName}_${n}`)) n++
      name = `UX_${table.physicalName}_${n}`
    }
    used.add(name)
    table.indexes.push({ name, columnPhysicalNames: resolved.names, unique: true })
  }

  // 6) 관계 — 자식·부모가 둘 다 살아 있고 컬럼도 실제 컬럼으로 해소될 때만(I-3)
  const relationships: DdlImportRelationship[] = []
  for (const fk of fks) {
    const child = alive.get(upper(fk.table))
    const parent = alive.get(upper(fk.refTable))
    // 참조 컬럼 생략(REFERENCES parent)은 "부모 PK를 참조한다"는 뜻이다. 파서는 이를
    // refColumns: []로 표현하고, 부모 PK를 아는 여기서 해석한다.
    const refColumns = fk.refColumns.length > 0 ? fk.refColumns : (pkOf.get(upper(fk.refTable)) ?? [])
    if (!child || !parent) {
      warnings.push({
        kind: 'unresolved-fk', target: fk.table,
        message: `참조 대상 ${fk.refTable}을 찾지 못해 관계를 만들지 않았습니다`,
      })
      continue
    }
    if (refColumns.length === 0 || fk.columns.length !== refColumns.length) {
      warnings.push({
        kind: 'unresolved-fk', target: fk.table,
        message: `${fk.refTable}의 참조 컬럼을 확정하지 못해 관계를 만들지 않았습니다`,
      })
      continue
    }
    const childColMap = colMapByTable.get(upper(fk.table))!
    const parentColMap = colMapByTable.get(upper(fk.refTable))!
    const columnPairs: Array<{ child: string; parent: string }> = []
    let unresolved: string | null = null
    for (let i = 0; i < fk.columns.length; i++) {
      const rawChild = fk.columns[i]!
      const rawParent = refColumns[i]!
      const childName = childColMap.get(upper(rawChild))
      const parentName = parentColMap.get(upper(rawParent))
      if (childName === undefined) { unresolved = `${fk.table}.${rawChild}`; break }
      if (parentName === undefined) { unresolved = `${fk.refTable}.${rawParent}`; break }
      columnPairs.push({ child: childName, parent: parentName })
    }
    if (unresolved) {
      warnings.push({
        kind: 'unresolved-fk', target: fk.table,
        message: `참조 컬럼 ${unresolved}을 찾지 못해 관계를 만들지 않았습니다`,
      })
      continue
    }
    const childPk = pkOf.get(upper(fk.table)) ?? []
    relationships.push({
      childPhysicalName: child.name, parentPhysicalName: parent.name,
      columnPairs,
      identifying: childPk.length > 0 && isSubset(fk.columns, childPk),
    })
  }

  // 7) 건너뛴 문장
  for (const s of parsed.skipped) {
    warnings.push({
      kind: 'skipped-statement', target: `${s.line}행`,
      message: `${s.keyword} 구문을 건너뛰었습니다`,
    })
  }

  const opCountEstimate =
    tables.length
    + tables.reduce((n, t) => n + t.columns.length + t.indexes.length, 0)
    + relationships.length

  return { tables, relationships, skippedTables, warnings, opCountEstimate }
}
