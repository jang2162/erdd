import type { Column, ProjectModel, Table } from './model.js'
import type { Dialect } from './dialect.js'
import { parseLogicalType } from './logical-type.js'
import { needsExplicitNullToken, resolveColumn } from './domain-resolve.js'
import { customFieldsFor } from './custom-field.js'
import { buildDbmlNote } from './dbml-note.js'
import { composeTableLogicalName, composeTablePhysicalName } from './name-template.js'
import type { NamingRules } from './naming.js'
import { buildNameMeta, serializeNameMeta } from './name-meta.js'
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

/**
 * 문자열. 개행이 있으면 트리플 쿼트를 쓴다(설명은 여러 줄일 수 있다).
 *
 * **두 경로 모두 백슬래시를 먼저 이스케이프한다.** 가져오기의 `unquote` 는 트리플 쿼트
 * 내용에도 `unescapeDbml` 을 적용하므로 여기서 빼면 비대칭이 된다 — 리터럴 `\t`·`\n` 이
 * 제어문자로 변조되고, 설명이 백슬래시로 끝나면 렉서가 닫는 `'''` 를 이스케이프로 먹어
 * **테이블이 통째로 사라진다**(리뷰 M-2). 백슬래시를 먼저 늘려야 뒤이어 만드는 `\'` 가
 * 다시 이스케이프되지 않는다.
 */
export function quoteDbmlString(s: string): string {
  const escaped = s.replace(/\\/g, '\\\\')
  if (s.includes('\n')) return `'''${escaped.replace(/'''/g, "\\'\\'\\'")}'''`
  return `'${escaped.replace(/'/g, "\\'")}'`
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
  // 양끝이 따옴표라는 것만으로는 문자열 리터럴이 아니다 — `'a' || 'b'` 같은 표현식도 양끝이
  // 따옴표다. 안쪽에 홀따옴표가 없을 때만(SQL 이스케이프 `''` 는 허용) 리터럴로 본다.
  if (/^'(?:[^']|'')*'$/.test(v)) return quoteDbmlString(v.slice(1, -1).replace(/''/g, "'"))
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  if (/^true$/i.test(v)) return 'true'
  if (/^false$/i.test(v)) return 'false'
  if (/^null$/i.test(v)) return 'null'
  // 표현식도 백슬래시를 먼저 늘린다 — quoteDbmlString 과 같은 이유다(리뷰 m-5). 빼면 가져오기의
  // 되돌리기와 비대칭이 되어 왕복마다 백슬래시가 두 배가 되고, 표현식이 백슬래시로 끝나면
  // 닫는 백틱을 렉서가 이스케이프로 먹어 테이블이 통째로 사라진다.
  return `\`${v.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
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
  // 복합 PK 컬럼은 인라인 pk 가 없으므로(indexes 블록으로 나간다) not null 을 그대로 낸다 —
  // **참인 말**이다(PK 는 not null 이다). 아래 null 가지가 `!col.isPk` 인 것과 다른 이유가 이것이다.
  if (!col.nullable && !inlinePk) settings.push('not null')
  // MySQL 의 nullable TIMESTAMP 함정을 막는다(판정 근거는 `needsExplicitNullToken`). DBML 을
  // 도구가 MySQL DDL 로 되돌릴 때 그 함정으로 그대로 돌아가는 것을 막는 것이다.
  // ⚠️ **판정은 DDL 쪽 `columnLine` 과 같고(같은 함수다) 정책은 다르다** — DDL 은 PK 여도 `NULL`
  // 을 내지만(SQL 에서 합법이고 PK 가 이긴다) DBML 은 pk 선언과 겹치지 않게 뺀다. 「같은 범위」가
  // 아니다. 단일 PK · nullable · TIMESTAMP · mysql 에서 DDL 은 `TIMESTAMP NULL` 을, DBML 은
  // `[pk]` 만 낸다 — 그 차이는 의도된 것이니 한쪽에 맞추지 마라.
  // ⚠️ 가드가 `!inlinePk` 가 아니라 **`!col.isPk`** 인 것은 위 not null 가지와 **이유가 다르기**
  // 때문이다. 복합 PK 컬럼에 not null 을 내는 것은 참이지만, null 을 내는 것은 **거짓**이다 —
  // 가져오기가 `nullable: !notNull && !isPk` 로 판정해 그 컬럼은 어차피 `nullable: false` 로 닫힌다.
  // `!inlinePk` 로 좁히면 복합 PK 에서 `[null]` 과 `indexes … [pk]` 가 동시에 나가 산출물이 스스로
  // 모순된 문장을 말한다. 「불일치」로 보고 두 가드를 통일하지 마라.
  // nullable 인 PK 컬럼은 실제로 도달 가능하다(편집기의 PK 체크박스는 nullable 을 끄지 않는다).
  if (col.nullable && !col.isPk && needsExplicitNullToken(dialect, r.sql)) {
    settings.push('null')
  }
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

function tableBlock(
  model: ProjectModel, table: Table, dialect: Dialect, rules: NamingRules,
): string {
  const tableName = composeTablePhysicalName(table, model, rules)
  const cols = tableColumns(model, table.id)
  const pks = cols.filter((c) => c.isPk)
  const lines = cols.map((c) => columnLine(model, c, dialect, pks.length === 1))

  const settings: string[] = []
  const group = table.groupId === null ? undefined : model.tableGroups[table.groupId]
  if (group) settings.push(`headercolor: ${normalizeHexColor(group.color)}`)
  // 「논리명==물리명이면 생략」 판정은 **양쪽 다 최종 이름**으로 한다(설계 D5).
  const note = buildDbmlNote(
    composeTableLogicalName(table, model, rules), tableName, table.comment,
    customOf(model, table, 'table'),
  )
  if (note !== null) settings.push(`note: ${quoteDbmlString(note)}`)
  const head = settings.length > 0 ? ` [${settings.join(', ')}]` : ''

  const ixLines = indexLines(model, table, cols)
  const body = ixLines.length > 0
    ? `${lines.join('\n')}\n\n  indexes {\n${ixLines.join('\n')}\n  }`
    : lines.join('\n')
  return `Table ${quoteDbmlIdent(tableName)}${head} {\n${body}\n}`
}

function groupBlocks(model: ProjectModel, tables: Table[], rules: NamingRules): string[] {
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
    const names = members
      .map((t) => `  ${quoteDbmlIdent(composeTablePhysicalName(t, model, rules))}`).join('\n')
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

function refLines(model: ProjectModel, selectedIds: Set<string>, rules: NamingRules): string[] {
  const compose = (t: Table) => composeTablePhysicalName(t, model, rules)
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
    out.push(`Ref${label}: ${side(compose(child), childCols)} ${op} ${side(compose(parent), parentCols)}`)
  }
  return out
}

// ⚠️ opts 를 `?:` 로 두면 뒤에 필수 인자를 못 붙인다(TS1016). 기본값 인자로 바꾼다.
export function generateDbml(
  model: ProjectModel, dialect: Dialect, scope: ExportScope = { kind: 'all' },
  opts: { projectName?: string } = {}, rules: NamingRules,
): string {
  const tables = selectTables(model, scope, rules).filter(
    (t) => tableColumns(model, t.id).length > 0 && !hasEmptyPhysicalName(model, t, rules),
  )
  const blocks: string[] = []
  if (opts.projectName) {
    blocks.push(
      `Project ${quoteDbmlIdent(opts.projectName)} {\n  database_type: '${DBML_DATABASE_TYPE[dialect]}'\n}`,
    )
  }
  for (const t of tables) blocks.push(tableBlock(model, t, dialect, rules))
  const selectedIds = new Set(tables.map((t) => t.id))
  blocks.push(...groupBlocks(model, tables, rules))
  blocks.push(...refLines(model, selectedIds, rules))
  // ⚠️ 머릿말은 Project 블록보다 **앞**이어야 파싱이 줍는다(첫 비주석 줄에서 멈추므로).
  const header = serializeNameMeta(buildNameMeta(model, tables, rules), '//')
  const body = blocks.join('\n\n')
  return header === null ? body : `${header}\n${body}`
}
