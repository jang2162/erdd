import type { Column, ProjectModel, Table } from './model.js'
import type { Dialect } from './dialect.js'
import { parseLogicalType } from './logical-type.js'
import { resolveColumn } from './domain-resolve.js'
import { customFieldsFor } from './custom-field.js'
import { buildDbmlNote } from './dbml-note.js'
import {
  selectTables, tableColumns, hasEmptyPhysicalName, type ExportScope,
} from './ddl.js'

/** dbdocs 가 읽는 값이다. 한국어 표시명(DIALECT_LABEL)을 쓰면 안 된다. */
export const DBML_DATABASE_TYPE: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL', oracle: 'Oracle', mssql: 'SQL Server',
}

const INT_KINDS = new Set(['SMALLINT', 'INT', 'BIGINT'])

function isIntegerType(type: string): boolean {
  const p = parseLogicalType(type)
  return p.ok && INT_KINDS.has(p.type.kind)
}

/** 식별자. 한글·예약어·숫자 시작이 전부 안전해지도록 항상 큰따옴표로 감싼다. */
export function quoteDbmlIdent(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 문자열. 개행이 있으면 트리플 쿼트를 쓴다(설명은 여러 줄일 수 있다). */
export function quoteDbmlString(s: string): string {
  if (s.includes('\n')) return `'''${s.replace(/'''/g, "\\'\\'\\'")}'''`
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** #RGB 를 #RRGGBB 로 편다. 그 외 형태는 그대로 둔다. */
export function normalizeHexColor(c: string): string {
  const m = /^#([0-9a-fA-F]{3})$/.exec(c.trim())
  if (!m) return c.trim()
  const [r, g, b] = m[1]!.split('')
  return `#${r}${r}${g}${g}${b}${b}`
}

/** 모델의 defaultValue 원문 → DBML 설정 값 (§4.2). 역은 dbml-parse 의 dbmlDefaultToRaw. */
export function rawDefaultToDbml(raw: string): string {
  const v = raw.trim()
  if (/^'.*'$/s.test(v)) return quoteDbmlString(v.slice(1, -1).replace(/''/g, "'"))
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  if (/^true$/i.test(v)) return 'true'
  if (/^false$/i.test(v)) return 'false'
  if (/^null$/i.test(v)) return 'null'
  return `\`${v.replace(/`/g, '\\`')}\``
}

function customOf(
  model: ProjectModel, entity: { custom: Record<string, string> }, target: 'table' | 'column',
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of customFieldsFor(model, target)) {
    const v = entity.custom[f.id]
    if (v !== undefined && v !== '') out[f.name] = v
  }
  return out
}

function columnLine(model: ProjectModel, col: Column, dialect: Dialect, singlePk: boolean): string {
  const r = resolveColumn(col, model, dialect)
  const settings: string[] = []
  const inlinePk = col.isPk && singlePk
  if (inlinePk) settings.push('pk')
  if (col.autoIncrement && col.isPk && isIntegerType(r.logicalType)) settings.push('increment')
  // pk 를 낸 컬럼에는 not null 을 덧붙이지 않는다 — DBML 에서 pk 는 not null 을 함의하고,
  // 가져오기도 `nullable: !notNull && !isPk` 로 판정하므로 왕복이 그대로 성립한다.
  // 복합 PK 컬럼은 인라인 pk 가 없으므로(indexes 블록으로 나간다) not null 을 그대로 낸다.
  if (!col.nullable && !inlinePk) settings.push('not null')
  if (r.defaultValue !== null && r.defaultValue !== '') {
    settings.push(`default: ${rawDefaultToDbml(r.defaultValue)}`)
  }
  const note = buildDbmlNote(col.logicalName, col.physicalName, col.comment, customOf(model, col, 'column'))
  if (note !== null) settings.push(`note: ${quoteDbmlString(note)}`)
  const tail = settings.length > 0 ? ` [${settings.join(', ')}]` : ''
  return `  ${quoteDbmlIdent(col.physicalName)} ${r.sql}${tail}`
}

function indexLines(model: ProjectModel, table: Table, cols: Column[]): string[] {
  const lines: string[] = []
  const pks = cols.filter((c) => c.isPk)
  if (pks.length > 1) {
    lines.push(`    (${pks.map((c) => quoteDbmlIdent(c.physicalName)).join(', ')}) [pk]`)
  }
  for (const ix of Object.values(model.indexes).filter((i) => i.tableId === table.id)) {
    const names = ix.columns
      .map((c) => model.columns[c.columnId]?.physicalName)
      .filter((n): n is string => n !== undefined && n !== '')
    if (names.length === 0) continue
    const settings = [ix.unique ? 'unique' : null, `name: ${quoteDbmlString(ix.name)}`]
      .filter((s): s is string => s !== null)
    lines.push(`    (${names.map(quoteDbmlIdent).join(', ')}) [${settings.join(', ')}]`)
  }
  return lines
}

function tableBlock(model: ProjectModel, table: Table, dialect: Dialect): string {
  const cols = tableColumns(model, table.id)
  const pks = cols.filter((c) => c.isPk)
  const lines = cols.map((c) => columnLine(model, c, dialect, pks.length === 1))

  const settings: string[] = []
  const group = table.groupId === null ? undefined : model.tableGroups[table.groupId]
  if (group) settings.push(`headercolor: ${normalizeHexColor(group.color)}`)
  const note = buildDbmlNote(
    table.logicalName, table.physicalName, table.comment, customOf(model, table, 'table'),
  )
  if (note !== null) settings.push(`note: ${quoteDbmlString(note)}`)
  const head = settings.length > 0 ? ` [${settings.join(', ')}]` : ''

  const ixLines = indexLines(model, table, cols)
  const body = ixLines.length > 0
    ? `${lines.join('\n')}\n\n  indexes {\n${ixLines.join('\n')}\n  }`
    : lines.join('\n')
  return `Table ${quoteDbmlIdent(table.physicalName)}${head} {\n${body}\n}`
}

function groupBlocks(model: ProjectModel, tables: Table[]): string[] {
  const byGroup = new Map<string, Table[]>()
  for (const t of tables) {
    if (t.groupId === null) continue
    const list = byGroup.get(t.groupId) ?? []
    list.push(t)
    byGroup.set(t.groupId, list)
  }
  const out: string[] = []
  for (const [groupId, members] of byGroup) {
    const g = model.tableGroups[groupId]
    if (!g) continue
    const names = members.map((t) => `  ${quoteDbmlIdent(t.physicalName)}`).join('\n')
    const settings = [`color: ${normalizeHexColor(g.color)}`]
    if (g.comment) settings.push(`note: ${quoteDbmlString(g.comment)}`)
    out.push(`TableGroup ${quoteDbmlIdent(g.name)} [${settings.join(', ')}] {\n${names}\n}`)
  }
  return out
}

function side(table: string, cols: string[]): string {
  const inner = cols.map(quoteDbmlIdent)
  return cols.length === 1
    ? `${quoteDbmlIdent(table)}.${inner[0]}`
    : `${quoteDbmlIdent(table)}.(${inner.join(', ')})`
}

function refLines(model: ProjectModel, selectedIds: Set<string>): string[] {
  const out: string[] = []
  for (const rel of Object.values(model.relationships)) {
    if (!selectedIds.has(rel.parentTableId) || !selectedIds.has(rel.childTableId)) continue
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    if (!parent || !child) continue
    const childCols = rel.columnMappings.map((m) => model.columns[m.childColumnId]?.physicalName ?? '')
    const parentCols = rel.columnMappings.map((m) => model.columns[m.parentColumnId]?.physicalName ?? '')
    if (childCols.length === 0) continue
    if (childCols.some((c) => c === '') || parentCols.some((c) => c === '')) continue
    // 이름은 rel.name 이 있을 때만 붙인다 — 폴백(FK_자식_부모)을 쓰면 되읽을 때
    // 원본에 없던 이름이 생겨 왕복이 깨진다(설계 §4.3).
    const label = rel.name && rel.name.trim() !== '' ? ` ${quoteDbmlIdent(rel.name)}` : ''
    const op = rel.cardinality === '1:1' ? '-' : '>'
    out.push(`Ref${label}: ${side(child.physicalName, childCols)} ${op} ${side(parent.physicalName, parentCols)}`)
  }
  return out
}

export function generateDbml(
  model: ProjectModel, dialect: Dialect, scope: ExportScope = { kind: 'all' },
  opts?: { projectName?: string },
): string {
  const tables = selectTables(model, scope).filter(
    (t) => tableColumns(model, t.id).length > 0 && !hasEmptyPhysicalName(model, t),
  )
  const blocks: string[] = []
  if (opts?.projectName) {
    blocks.push(
      `Project ${quoteDbmlIdent(opts.projectName)} {\n  database_type: '${DBML_DATABASE_TYPE[dialect]}'\n}`,
    )
  }
  for (const t of tables) blocks.push(tableBlock(model, t, dialect))
  const selectedIds = new Set(tables.map((t) => t.id))
  blocks.push(...groupBlocks(model, tables))
  blocks.push(...refLines(model, selectedIds))
  return blocks.join('\n\n')
}
