import {
  CHANGESET_FORMAT,
  type AlterAction, type Changeset, type ChangesetHeader, type ColumnChange, type ColumnDef,
  type DialectTypes, type ForeignKeyDef, type IndexDef, type Statement, type TableDef,
} from './types.js'
import { Cursor, ParseFailure } from './syntax.js'

export type ParseChangesetResult =
  | { ok: true; changeset: Changeset }
  | { ok: false; line: number; message: string }

type Line = { no: number; text: string }

/**
 * 줄 끝 `@id`. **꼬리표를 싣는 줄에서만** 떼어 낸다 — 값(코멘트 등) 안의 `@` 를 꼬리표로 오인하지
 * 않게. id 문자 집합을 좁혀 두는 것도 같은 이유다(`'…@x'` 의 따옴표가 꼬리표에 섞이지 않는다).
 */
const ID_TAG = /[ \t]+@([A-Za-z0-9_.:-]+)[ \t]*$/

const FIELDS = ['type', 'dialects', 'nullable', 'default', 'increment', 'comment', 'check', 'position'] as const

export function parseChangeset(text: string): ParseChangesetResult {
  const lines: Line[] = text.replace(/^﻿/, '').split('\n')
    .map((t, i) => ({ no: i + 1, text: t.replace(/\r$/, '') }))
    .filter((l) => {
      const s = l.text.trim()
      return s !== '' && !s.startsWith('//')
    })
  try {
    return { ok: true, changeset: new Parser(lines).parse() }
  } catch (err) {
    if (err instanceof ParseFailure) return { ok: false, line: err.line, message: err.message }
    throw err
  }
}

class Parser {
  #i = 0
  constructor(readonly lines: Line[]) {}

  #next(what: string): Line {
    const l = this.lines[this.#i]
    if (l === undefined) {
      const last = this.lines[this.lines.length - 1]?.no ?? 1
      throw new ParseFailure(last, `${what} 이(가) 와야 하는데 파일이 끝났습니다`)
    }
    this.#i += 1
    return l
  }
  #tagged(l: Line): { c: Cursor; id: string } {
    const m = ID_TAG.exec(l.text)
    if (m === null) throw new ParseFailure(l.no, '줄 끝에 @id 가 없습니다')
    return { c: new Cursor(l.text.slice(0, m.index), l.no), id: m[1]! }
  }
  #isClose(l: Line): boolean { return l.text.trim() === '}' }

  parse(): Changeset {
    const header = this.#header()
    const statements: Statement[] = []
    while (this.#i < this.lines.length) statements.push(this.#statement(this.#next('문장')))
    return { header, statements }
  }

  #header(): ChangesetHeader {
    const first = this.#next("changeset '<이름>' {")
    const c = new Cursor(first.text, first.no)
    c.word('changeset')
    const name = c.string()
    c.symbol('{')
    c.end()
    let format: number | null = null
    let created: string | null = null
    let baseline = false
    for (;;) {
      const l = this.#next('}')
      if (this.#isClose(l)) break
      const k = new Cursor(l.text, l.no)
      if (k.tryWord('format')) { k.symbol(':'); format = k.integer() }
      else if (k.tryWord('created')) { k.symbol(':'); created = k.string() }
      else if (k.tryWord('baseline')) { k.symbol(':'); baseline = k.trueFalse() }
      else k.fail('알 수 없는 머릿말 항목입니다 — format·created·baseline 만 쓸 수 있습니다')
      k.end()
    }
    if (format === null) throw new ParseFailure(first.no, '머릿말에 format 이 없습니다')
    if (format > CHANGESET_FORMAT) {
      throw new ParseFailure(first.no, `format ${format} 은(는) 이 ERDD 가 모르는 형식입니다 — 더 새 ERDD 로 만든 기록입니다. CLI 를 올리세요`)
    }
    if (created === null) throw new ParseFailure(first.no, '머릿말에 created 가 없습니다')
    return { format, name, created, baseline }
  }

  #statement(l: Line): Statement {
    const head = l.text.trimStart()
    const starts = (p: string) => head.startsWith(`${p} `)
    const line = l.no
    if (starts('drop foreign key') || starts('add foreign key')) {
      const drop = starts('drop foreign key')
      const { c, id } = this.#tagged(l)
      c.word(drop ? 'drop foreign key' : 'add foreign key')
      const fk = this.#foreignKey(c, id)
      c.end()
      return drop ? { kind: 'dropForeignKey', fk, line } : { kind: 'addForeignKey', fk, line }
    }
    if (starts('drop index') || starts('add index')) {
      const drop = starts('drop index')
      const { c, id } = this.#tagged(l)
      c.word(drop ? 'drop index' : 'add index')
      const index = this.#index(c, id)
      c.end()
      return drop ? { kind: 'dropIndex', index, line } : { kind: 'addIndex', index, line }
    }
    if (starts('rename index')) {
      const { c, id } = this.#tagged(l)
      c.word('rename index')
      const from = c.ident()
      c.symbol('->')
      const to = c.ident()
      c.word('on')
      const table = c.ident()
      c.end()
      return { kind: 'renameIndex', id, table, from, to, line }
    }
    if (starts('drop table')) return { kind: 'dropTable', table: this.#tableBlock(l, 'drop'), line }
    if (starts('create table')) return { kind: 'createTable', table: this.#tableBlock(l, 'create'), line }
    if (starts('rename table')) {
      const { c, id } = this.#tagged(l)
      c.word('rename table')
      const from = c.ident()
      c.symbol('->')
      const to = c.ident()
      c.end()
      return { kind: 'renameTable', id, from, to, line }
    }
    if (starts('alter table')) return this.#alter(l)
    throw new ParseFailure(line, `알 수 없는 문장입니다: '${head.slice(0, 30)}'`)
  }

  #parenIdents(c: Cursor): string[] {
    c.symbol('(')
    const out = [c.ident()]
    while (c.trySymbol(',')) out.push(c.ident())
    c.symbol(')')
    return out
  }

  #foreignKey(c: Cursor, id: string): ForeignKeyDef {
    const name = c.ident()
    const child = c.ident()
    const childColumns = this.#parenIdents(c)
    c.symbol('->')
    const parent = c.ident()
    const parentColumns = this.#parenIdents(c)
    if (childColumns.length !== parentColumns.length) c.fail('자식 컬럼과 부모 컬럼의 개수가 다릅니다')
    c.symbol('[')
    let cardinality: '1:1' | '1:N'
    if (c.trySymbol('1:1')) cardinality = '1:1'
    else { c.symbol('1:N'); cardinality = '1:N' }
    let uniqueName: string | null = null
    if (c.trySymbol(',')) { c.word('unique'); c.symbol(':'); uniqueName = c.ident() }
    c.symbol(']')
    return { id, name, child, childColumns, parent, parentColumns, cardinality, uniqueName }
  }

  #indexColumns(c: Cursor): IndexDef['columns'] {
    c.symbol('(')
    const out: IndexDef['columns'] = []
    do {
      const name = c.ident()
      let direction: 'asc' | 'desc'
      if (c.tryWord('asc')) direction = 'asc'
      else { c.word('desc'); direction = 'desc' }
      out.push({ name, direction })
    } while (c.trySymbol(','))
    c.symbol(')')
    return out
  }
  #uniqueTail(c: Cursor): boolean {
    if (!c.trySymbol('[')) return false
    c.word('unique')
    c.symbol(']')
    return true
  }
  #index(c: Cursor, id: string): IndexDef {
    const name = c.ident()
    c.word('on')
    const table = c.ident()
    const columns = this.#indexColumns(c)
    return { id, name, table, columns, unique: this.#uniqueTail(c) }
  }

  #columnDef(c: Cursor, id: string, allowAfter: boolean): { column: ColumnDef; after: string | null } {
    const name = c.ident()
    const type = c.type()
    let nullable: boolean | null = null
    let increment = false
    let dflt: string | null = null
    let comment: string | null = null
    let check: string[] = []
    const dialectTypes: DialectTypes = {}
    let after: string | null | undefined
    c.symbol('[')
    do {
      if (c.tryWord('not null')) nullable = false
      else if (c.tryWord('null')) nullable = true
      else if (c.tryWord('increment')) increment = true
      else if (c.tryWord('default')) { c.symbol(':'); dflt = c.raw() }
      else if (c.tryWord('comment')) { c.symbol(':'); comment = c.string() }
      else if (c.tryWord('check')) { c.symbol(':'); check = c.checkList() }
      else if (allowAfter && c.tryWord('after')) { c.symbol(':'); after = c.ident() }
      else if (allowAfter && c.tryWord('first')) after = null
      else {
        const d = c.tryDialect()
        if (d === null) c.fail('알 수 없는 컬럼 속성입니다')
        c.symbol(':')
        dialectTypes[d] = c.type()
      }
    } while (c.trySymbol(','))
    c.symbol(']')
    if (nullable === null) c.fail('null 또는 not null 이 와야 합니다')
    if (allowAfter && after === undefined) c.fail('add column 에는 after: <컬럼> 또는 first 가 와야 합니다')
    return {
      column: { id, name, type, dialectTypes, nullable, default: dflt, increment, comment, check },
      after: after ?? null,
    }
  }

  #tableBlock(l: Line, verb: 'create' | 'drop'): TableDef {
    const { c, id } = this.#tagged(l)
    c.word(`${verb} table`)
    const name = c.ident()
    let comment: string | null = null
    if (c.trySymbol('[')) { c.word('comment'); c.symbol(':'); comment = c.string(); c.symbol(']') }
    c.symbol('{')
    c.end()
    const columns: ColumnDef[] = []
    let primaryKey: string[] = []
    const indexes: IndexDef[] = []
    for (;;) {
      const inner = this.#next('}')
      if (this.#isClose(inner)) break
      const t = inner.text.trimStart()
      if (t.startsWith('column ')) {
        const { c: x, id: cid } = this.#tagged(inner)
        x.word('column')
        columns.push(this.#columnDef(x, cid, false).column)
        x.end()
      } else if (t.startsWith('primary key')) {
        const x = new Cursor(inner.text, inner.no)
        x.word('primary key')
        primaryKey = x.identList()
        x.end()
      } else if (verb === 'drop' && t.startsWith('index ')) {
        const { c: x, id: xid } = this.#tagged(inner)
        x.word('index')
        const ixName = x.ident()
        const ixColumns = this.#indexColumns(x)
        const unique = this.#uniqueTail(x)
        x.end()
        indexes.push({ id: xid, name: ixName, table: name, columns: ixColumns, unique })
      } else {
        throw new ParseFailure(inner.no, `${verb} table 블록에 올 수 없는 줄입니다`)
      }
    }
    return { id, name, comment, columns, primaryKey, indexes }
  }

  #alter(l: Line): Statement {
    const { c, id } = this.#tagged(l)
    c.word('alter table')
    const name = c.ident()
    c.symbol('{')
    c.end()
    const actions: AlterAction[] = []
    for (;;) {
      const a = this.#next('}')
      if (this.#isClose(a)) break
      const t = a.text.trimStart()
      const line = a.no
      if (t.startsWith('drop column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('drop column')
        const { column } = this.#columnDef(x, cid, false)
        x.end()
        actions.push({ kind: 'dropColumn', column, line })
      } else if (t.startsWith('rename column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('rename column')
        const from = x.ident()
        x.symbol('->')
        const to = x.ident()
        x.end()
        actions.push({ kind: 'renameColumn', id: cid, from, to, line })
      } else if (t.startsWith('add column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('add column')
        const { column, after } = this.#columnDef(x, cid, true)
        x.end()
        actions.push({ kind: 'addColumn', column, after, line })
      } else if (t.startsWith('modify column ')) {
        const { c: x, id: cid } = this.#tagged(a)
        x.word('modify column')
        const colName = x.ident()
        x.symbol('{')
        x.end()
        actions.push({ kind: 'modifyColumn', id: cid, name: colName, changes: this.#changes(line), line })
      } else if (t.startsWith('primary key')) {
        const x = new Cursor(a.text, line)
        x.word('primary key')
        x.symbol(':')
        const from = x.identList()
        x.symbol('->')
        const to = x.identList()
        x.end()
        actions.push({ kind: 'primaryKey', from, to, line })
      } else if (t.startsWith('comment')) {
        const x = new Cursor(a.text, line)
        x.word('comment')
        x.symbol(':')
        const from = x.nullableString()
        x.symbol('->')
        const to = x.nullableString()
        x.end()
        actions.push({ kind: 'tableComment', from, to, line })
      } else {
        throw new ParseFailure(line, 'alter table 블록에 올 수 없는 줄입니다')
      }
    }
    return { kind: 'alterTable', id, name, actions, line: l.no }
  }

  #changes(openLine: number): ColumnChange[] {
    const changes: ColumnChange[] = []
    for (;;) {
      const l = this.#next('}')
      if (this.#isClose(l)) break
      const c = new Cursor(l.text, l.no)
      const field = c.ident()
      if (!(FIELDS as readonly string[]).includes(field)) c.fail(`modify column 에 올 수 없는 항목입니다: ${field}`)
      c.symbol(':')
      const from = readFieldValue(field as ColumnChange['field'], c)
      c.symbol('->')
      const to = readFieldValue(field as ColumnChange['field'], c)
      c.end()
      // field 와 값의 짝은 readFieldValue 가 보장한다 — 유니온을 손으로 좁히는 대신 한 번 단언한다.
      changes.push({ field, from, to } as ColumnChange)
    }
    if (changes.length === 0) throw new ParseFailure(openLine, 'modify column 블록이 비었습니다')
    return changes
  }
}

function readFieldValue(field: ColumnChange['field'], c: Cursor): unknown {
  switch (field) {
    case 'type': return c.type()
    case 'dialects': return c.dialects()
    case 'nullable':
    case 'increment': return c.bool()
    case 'default': return c.defaultValue()
    case 'comment': return c.nullableString()
    case 'check': return c.checkList()
    case 'position': return c.position()
  }
}
