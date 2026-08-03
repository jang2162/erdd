import { fromDialectType, type Dialect } from './dialect.js'
import type { ProjectModel } from './model.js'
import { restoreLogicalName, type NamingRules } from './naming.js'
import type { ParsedDdl, ParsedTable, ParsedConstraint } from './ddl-parse.js'

export type DdlImportWarning = {
  kind: 'ambiguous-type' | 'unknown-type' | 'unknown-word'
      | 'table-conflict' | 'unresolved-fk' | 'skipped-statement'
  target: string
  message: string
}
export type DdlImportColumn = {
  physicalName: string; logicalName: string; type: string
  isPk: boolean; nullable: boolean; autoIncrement: boolean
  defaultValue: string | null; comment: string | null
}
export type DdlImportTable = {
  physicalName: string; logicalName: string
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

  // 1) 이름 충돌 판정 — 살아남은 테이블만 alive에 남는다
  const existing = new Set(Object.values(model.tables).map((t) => upper(t.physicalName)))
  const skippedTables: string[] = []
  const alive = new Map<string, ParsedTable>()
  for (const t of parsed.tables) {
    if (existing.has(upper(t.name))) {
      skippedTables.push(t.name)
      warnings.push({ kind: 'table-conflict', target: t.name, message: '같은 이름의 테이블이 이미 있어 건너뜁니다' })
      continue
    }
    alive.set(upper(t.name), t)
  }

  // 2) 제약 색인 — PK는 먼저 나온 것을 쓴다(인라인 + 테이블 수준 중복 방지)
  const pkOf = new Map<string, string[]>()
  const fks: Array<Extract<ParsedConstraint, { kind: 'fk' }>> = []
  for (const c of parsed.constraints) {
    if (c.kind === 'pk') { if (!pkOf.has(upper(c.table))) pkOf.set(upper(c.table), c.columns) }
    else if (c.kind === 'fk') fks.push(c)
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

  // 4) 테이블·컬럼 변환
  const tables: DdlImportTable[] = []
  for (const t of alive.values()) {
    const pkCols = new Set((pkOf.get(upper(t.name)) ?? []).map(upper))
    const named = resolveName(t.name, tableComment.get(upper(t.name)), t.name)
    const columns: DdlImportColumn[] = t.columns.map((c) => {
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

    // 5) 인덱스 — PK와 컬럼이 정확히 같은 유니크 인덱스는 조용히 제외
    const pkList = pkOf.get(upper(t.name)) ?? []
    const indexes = parsed.indexes
      .filter((ix) => upper(ix.table) === upper(t.name))
      .filter((ix) => !(ix.unique && pkList.length > 0 && sameSet(ix.columns, pkList)))
      .map((ix) => ({ name: ix.name, columnPhysicalNames: ix.columns, unique: ix.unique }))

    tables.push({ physicalName: t.name, logicalName: named.logicalName, columns, indexes })
  }

  // 6) 관계 — 자식·부모가 둘 다 살아 있을 때만
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
    const childPk = pkOf.get(upper(fk.table)) ?? []
    relationships.push({
      childPhysicalName: child.name, parentPhysicalName: parent.name,
      columnPairs: fk.columns.map((c, i) => ({ child: c, parent: refColumns[i]! })),
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
