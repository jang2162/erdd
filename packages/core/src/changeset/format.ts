import { DIALECTS } from '../dialect.js'
import type { AlterAction, Changeset, ColumnDef, ForeignKeyDef, IndexDef, Statement, TableDef } from './types.js'
import {
  fmtCheckList, fmtFieldValue, fmtIdent, fmtIdentList, fmtNullableString, fmtRaw, fmtString, fmtType,
} from './syntax.js'

/** 모든 기록 파일의 첫 줄. 사람이 파일을 처음 열었을 때 무엇인지 알게 한다. */
export const CHANGESET_BANNER = '// ERDD 변경 기록 — 이 파일을 보고 마이그레이션을 직접 작성한다. 만든 뒤에는 고치지 않는다'

const TAG_COLUMN = 64

/** 줄 끝 `@id` 꼬리표. 사람이 건너뛰기 쉽게 같은 열에 맞춘다(guide 「재생은 `@id` 로 대상을 찾는다」). */
function tagged(text: string, id: string): string {
  return `${text.padEnd(Math.max(TAG_COLUMN, text.length + 2))}@${id}`
}

function columnAttrs(c: ColumnDef, after?: string | null): string {
  const parts = [c.nullable ? 'null' : 'not null']
  if (c.increment) parts.push('increment')
  if (c.default !== null) parts.push(`default: ${fmtRaw(c.default)}`)
  if (c.comment !== null) parts.push(`comment: ${fmtString(c.comment)}`)
  if (c.check.length > 0) parts.push(`check: ${fmtCheckList(c.check)}`)
  for (const d of DIALECTS) {
    const v = c.dialectTypes[d]
    if (v !== undefined) parts.push(`${d}: ${fmtType(v)}`)
  }
  if (after !== undefined) parts.push(after === null ? 'first' : `after: ${fmtIdent(after)}`)
  return `[${parts.join(', ')}]`
}
const columnLine = (c: ColumnDef, after?: string | null) =>
  `${fmtIdent(c.name)} ${fmtType(c.type)} ${columnAttrs(c, after)}`
const indexColumns = (ix: IndexDef) =>
  `(${ix.columns.map((c) => `${fmtIdent(c.name)} ${c.direction}`).join(', ')})`
const uniqueTail = (ix: IndexDef) => (ix.unique ? ' [unique]' : '')
const indexLine = (ix: IndexDef) => `${fmtIdent(ix.name)} on ${fmtIdent(ix.table)} ${indexColumns(ix)}${uniqueTail(ix)}`
function fkLine(fk: ForeignKeyDef): string {
  const child = `${fmtIdent(fk.child)}(${fk.childColumns.map(fmtIdent).join(', ')})`
  const parent = `${fmtIdent(fk.parent)}(${fk.parentColumns.map(fmtIdent).join(', ')})`
  const unique = fk.uniqueName === null ? '' : `, unique: ${fmtIdent(fk.uniqueName)}`
  return `${fmtIdent(fk.name)} ${child} -> ${parent} [${fk.cardinality}${unique}]`
}

function tableBlock(verb: 'create' | 'drop', t: TableDef): string[] {
  const comment = t.comment === null ? '' : ` [comment: ${fmtString(t.comment)}]`
  const lines = [tagged(`${verb} table ${fmtIdent(t.name)}${comment} {`, t.id)]
  for (const c of t.columns) lines.push(tagged(`  column ${columnLine(c)}`, c.id))
  if (t.primaryKey.length > 0) lines.push(`  primary key ${fmtIdentList(t.primaryKey)}`)
  for (const ix of t.indexes) lines.push(tagged(`  index ${fmtIdent(ix.name)} ${indexColumns(ix)}${uniqueTail(ix)}`, ix.id))
  lines.push('}')
  return lines
}

function alterLines(a: AlterAction): string[] {
  switch (a.kind) {
    case 'dropColumn': return [tagged(`  drop column ${columnLine(a.column)}`, a.column.id)]
    case 'renameColumn': return [tagged(`  rename column ${fmtIdent(a.from)} -> ${fmtIdent(a.to)}`, a.id)]
    case 'addColumn': return [tagged(`  add column ${columnLine(a.column, a.after)}`, a.column.id)]
    case 'modifyColumn': return [
      tagged(`  modify column ${fmtIdent(a.name)} {`, a.id),
      ...a.changes.map((ch) => `    ${ch.field}: ${fmtFieldValue(ch.field, ch.from)} -> ${fmtFieldValue(ch.field, ch.to)}`),
      '  }',
    ]
    case 'primaryKey': return [`  primary key: ${fmtIdentList(a.from)} -> ${fmtIdentList(a.to)}`]
    case 'tableComment': return [`  comment: ${fmtNullableString(a.from)} -> ${fmtNullableString(a.to)}`]
  }
}

function statementLines(s: Statement): string[] {
  switch (s.kind) {
    case 'dropForeignKey': return [tagged(`drop foreign key ${fkLine(s.fk)}`, s.fk.id)]
    case 'dropIndex': return [tagged(`drop index ${indexLine(s.index)}`, s.index.id)]
    case 'renameIndex': return [tagged(`rename index ${fmtIdent(s.from)} -> ${fmtIdent(s.to)} on ${fmtIdent(s.table)}`, s.id)]
    case 'dropTable': return tableBlock('drop', s.table)
    case 'renameTable': return [tagged(`rename table ${fmtIdent(s.from)} -> ${fmtIdent(s.to)}`, s.id)]
    case 'createTable': return tableBlock('create', s.table)
    case 'alterTable': return [tagged(`alter table ${fmtIdent(s.name)} {`, s.id), ...s.actions.flatMap(alterLines), '}']
    case 'addIndex': return [tagged(`add index ${indexLine(s.index)}`, s.index.id)]
    case 'addForeignKey': return [tagged(`add foreign key ${fkLine(s.fk)}`, s.fk.id)]
  }
}

const isBlock = (s: Statement) => s.kind === 'dropTable' || s.kind === 'createTable' || s.kind === 'alterTable'

/** 문장만(머릿말 없이). 웹·CLI 의 「미기록 변경」 미리보기가 이것을 보여 준다. */
export function formatStatements(statements: readonly Statement[]): string {
  const out: string[] = []
  let prevBlock = false
  for (const [i, s] of statements.entries()) {
    const block = isBlock(s)
    if (i > 0 && (block || prevBlock)) out.push('')
    out.push(...statementLines(s))
    prevBlock = block
  }
  return out.join('\n')
}

export function formatChangeset(cs: Changeset): string {
  const h = cs.header
  const head = [
    CHANGESET_BANNER,
    `changeset ${fmtString(h.name)} {`,
    `  format: ${h.format}`,
    `  created: ${fmtString(h.created)}`,
    ...(h.baseline ? ['  baseline: true'] : []),
    '}',
  ]
  const body = formatStatements(cs.statements)
  return `${head.join('\n')}\n${body === '' ? '' : `\n${body}\n`}`
}
