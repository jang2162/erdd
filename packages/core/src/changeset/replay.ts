import { deepEqual } from '../equal.js'
import {
  compareCodeUnits, emptyProjection,
  type AlterAction, type ChangeIssue, type Changeset, type ColumnChange, type ColumnDef,
  type ProjColumn, type ProjTable, type SchemaProjection, type Statement,
} from './types.js'
import { fmtFieldValue, fmtIdentList, fmtNullableString } from './syntax.js'

export class ReplayFailure extends Error {
  constructor(readonly line: number | null, message: string) {
    super(message)
    this.name = 'ReplayFailure'
  }
}

export type ReplayWarning = { line: number | null; message: string }
export type ChangesetRecord = { file: string; changeset: Changeset }
export type ReplayResult = { projection: SchemaProjection; warnings: ChangeIssue[]; error: ChangeIssue | null }

type Fail = (message: string) => never
type Warn = (message: string) => void

/**
 * 기록 전부를 **파일명 순**으로 빈 투영에 재생한다 — 이것이 기준선의 유일한 원천이다
 * (guide 「재생은 `@id` 로 대상을 찾는다」). 첫 실패에서 멈추고 그 파일·줄을 돌려준다.
 */
export function replay(records: readonly ChangesetRecord[]): ReplayResult {
  const projection = emptyProjection()
  const warnings: ChangeIssue[] = []
  for (const r of [...records].sort((a, b) => compareCodeUnits(a.file, b.file))) {
    try {
      for (const w of applyChangeset(projection, r.changeset)) warnings.push({ file: r.file, line: w.line, message: w.message })
    } catch (err) {
      if (err instanceof ReplayFailure) return { projection, warnings, error: { file: r.file, line: err.line, message: err.message } }
      throw err
    }
  }
  return { projection, warnings, error: null }
}

/** 기록 하나를 `p` 에 제자리 적용한다. 대상은 `@id` 로 찾고, FK·인덱스·PK·after 의 참조만 이름으로 푼다. */
export function applyChangeset(p: SchemaProjection, cs: Changeset): ReplayWarning[] {
  const warnings: ReplayWarning[] = []
  for (const s of cs.statements) applyStatement(p, s, warnings)
  return warnings
}

function applyStatement(p: SchemaProjection, s: Statement, warnings: ReplayWarning[]): void {
  const line = s.line ?? null
  const fail: Fail = (m) => { throw new ReplayFailure(line, m) }
  const warn: Warn = (m) => { warnings.push({ line, message: m }) }
  switch (s.kind) {
    case 'dropForeignKey': {
      if (p.foreignKeys[s.fk.id] === undefined) fail(`지울 FK @${s.fk.id}(${s.fk.name}) 이(가) 없습니다`)
      delete p.foreignKeys[s.fk.id]
      return
    }
    case 'dropIndex': {
      if (p.indexes[s.index.id] === undefined) fail(`지울 인덱스 @${s.index.id}(${s.index.name}) 이(가) 없습니다`)
      delete p.indexes[s.index.id]
      return
    }
    case 'renameIndex': {
      const ix = p.indexes[s.id] ?? fail(`이름을 바꿀 인덱스 @${s.id}(${s.from}) 이(가) 없습니다`)
      if (ix.name !== s.from) warn(`인덱스 이름의 이전 값이 ${s.from} 이(가) 아니라 ${ix.name} 입니다`)
      ix.name = s.to
      return
    }
    case 'dropTable': {
      const t = p.tables[s.table.id] ?? fail(`지울 테이블 @${s.table.id}(${s.table.name}) 이(가) 없습니다`)
      for (const cid of t.columnIds) delete p.columns[cid]
      for (const ix of Object.values(p.indexes)) if (ix.tableId === t.id) delete p.indexes[ix.id]
      for (const fk of Object.values(p.foreignKeys)) {
        if (fk.childTableId !== t.id && fk.parentTableId !== t.id) continue
        delete p.foreignKeys[fk.id]
        warn(`${t.name} 테이블과 함께 FK ${fk.name} 도 지웠습니다 — 앞선 기록이 그 FK 를 지우지 않았습니다`)
      }
      delete p.tables[t.id]
      return
    }
    case 'renameTable': {
      const t = p.tables[s.id] ?? fail(`이름을 바꿀 테이블 @${s.id}(${s.from}) 이(가) 없습니다`)
      if (t.name !== s.from) warn(`테이블 이름의 이전 값이 ${s.from} 이(가) 아니라 ${t.name} 입니다`)
      t.name = s.to
      return
    }
    case 'createTable': {
      if (p.tables[s.table.id] !== undefined) fail(`만들 테이블 @${s.table.id}(${s.table.name}) 이(가) 이미 있습니다`)
      const t: ProjTable = { id: s.table.id, name: s.table.name, comment: s.table.comment, columnIds: [], primaryKey: [] }
      p.tables[t.id] = t
      for (const c of s.table.columns) {
        addColumnEntity(p, t.id, c, fail)
        t.columnIds.push(c.id)
      }
      t.primaryKey = s.table.primaryKey.map((n) => columnIdByName(p, t, n, fail))
      return
    }
    case 'alterTable': applyAlter(p, s, warnings); return
    case 'addIndex': {
      if (p.indexes[s.index.id] !== undefined) fail(`만들 인덱스 @${s.index.id}(${s.index.name}) 이(가) 이미 있습니다`)
      const t = tableByName(p, s.index.table, fail)
      p.indexes[s.index.id] = {
        id: s.index.id, tableId: t.id, name: s.index.name,
        columns: s.index.columns.map((c) => ({ columnId: columnIdByName(p, t, c.name, fail), direction: c.direction })),
        unique: s.index.unique,
      }
      return
    }
    case 'addForeignKey': {
      if (p.foreignKeys[s.fk.id] !== undefined) fail(`만들 FK @${s.fk.id}(${s.fk.name}) 이(가) 이미 있습니다`)
      const child = tableByName(p, s.fk.child, fail)
      const parent = tableByName(p, s.fk.parent, fail)
      p.foreignKeys[s.fk.id] = {
        id: s.fk.id, name: s.fk.name,
        childTableId: child.id, childColumnIds: s.fk.childColumns.map((n) => columnIdByName(p, child, n, fail)),
        parentTableId: parent.id, parentColumnIds: s.fk.parentColumns.map((n) => columnIdByName(p, parent, n, fail)),
        cardinality: s.fk.cardinality, uniqueName: s.fk.uniqueName,
      }
      return
    }
  }
}

function applyAlter(p: SchemaProjection, s: Extract<Statement, { kind: 'alterTable' }>, warnings: ReplayWarning[]): void {
  const headLine = s.line ?? null
  const t = p.tables[s.id] ?? (() => { throw new ReplayFailure(headLine, `고칠 테이블 @${s.id}(${s.name}) 이(가) 없습니다`) })()
  if (t.name !== s.name) warnings.push({ line: headLine, message: `테이블 이름이 ${s.name} 이(가) 아니라 ${t.name} 입니다` })
  const placed: { id: string; after: string | null }[] = []
  for (const a of s.actions) applyAction(p, t, a, placed, warnings, headLine)
  if (placed.length > 0) {
    t.columnIds = resolveOrder(p, t, placed, (m) => { throw new ReplayFailure(headLine, m) })
  }
}

function applyAction(
  p: SchemaProjection, t: ProjTable, a: AlterAction,
  placed: { id: string; after: string | null }[], warnings: ReplayWarning[], headLine: number | null,
): void {
  const line = a.line ?? headLine
  const fail: Fail = (m) => { throw new ReplayFailure(line, m) }
  const warn: Warn = (m) => { warnings.push({ line, message: m }) }
  switch (a.kind) {
    case 'dropColumn': {
      const col = columnOf(p, t, a.column.id, a.column.name, fail)
      delete p.columns[col.id]
      t.columnIds = t.columnIds.filter((id) => id !== col.id)
      t.primaryKey = t.primaryKey.filter((id) => id !== col.id)
      return
    }
    case 'renameColumn': {
      const col = columnOf(p, t, a.id, a.from, fail)
      if (col.name !== a.from) warn(`${t.name}.${a.from} 컬럼 이름의 이전 값이 ${a.from} 이(가) 아니라 ${col.name} 입니다`)
      col.name = a.to
      return
    }
    case 'addColumn': {
      addColumnEntity(p, t.id, a.column, fail)
      placed.push({ id: a.column.id, after: a.after })
      return
    }
    case 'modifyColumn': {
      const col = columnOf(p, t, a.id, a.name, fail)
      for (const ch of a.changes) {
        // position 의 이전 값은 참고용이다 — 경합 판정에 쓰지 않는다(guide 「경합은 경고다」).
        if (ch.field === 'position') { placed.push({ id: col.id, after: ch.to }); continue }
        const cur = currentValue(col, ch.field)
        if (!deepEqual(cur, ch.from)) {
          warn(`${t.name}.${col.name} ${ch.field} 의 이전 값이 ${fmtFieldValue(ch.field, ch.from)} 이(가) 아니라 ${fmtFieldValue(ch.field, cur)} 입니다`)
        }
        setValue(col, ch)
      }
      return
    }
    case 'primaryKey': {
      const cur = t.primaryKey.map((id) => p.columns[id]?.name ?? id)
      if (!deepEqual(cur, a.from)) warn(`${t.name} 기본 키의 이전 값이 ${fmtIdentList(a.from)} 이(가) 아니라 ${fmtIdentList(cur)} 입니다`)
      t.primaryKey = a.to.map((n) => columnIdByName(p, t, n, fail))
      return
    }
    case 'tableComment': {
      if (t.comment !== a.from) warn(`${t.name} 테이블 코멘트의 이전 값이 ${fmtNullableString(a.from)} 이(가) 아니라 ${fmtNullableString(t.comment)} 입니다`)
      t.comment = a.to
      return
    }
  }
}

type ValueField = Exclude<ColumnChange['field'], 'position'>

function currentValue(c: ProjColumn, field: ValueField): unknown {
  switch (field) {
    case 'type': return c.type
    case 'dialects': return c.dialectTypes
    case 'nullable': return c.nullable
    case 'default': return c.default
    case 'increment': return c.increment
    case 'comment': return c.comment
    case 'check': return c.check
  }
}

function setValue(c: ProjColumn, ch: Exclude<ColumnChange, { field: 'position' }>): void {
  switch (ch.field) {
    case 'type': c.type = ch.to; return
    case 'dialects': c.dialectTypes = { ...ch.to }; return
    case 'nullable': c.nullable = ch.to; return
    case 'default': c.default = ch.to; return
    case 'increment': c.increment = ch.to; return
    case 'comment': c.comment = ch.to; return
    case 'check': c.check = [...ch.to]; return
  }
}

/**
 * 블록 끝에서 한 번에 순서를 정한다(guide 「`after` 는 최종 순서의 바로 앞 컬럼이다」).
 * 추가·이동한 컬럼(placed)을 뺀 나머지는 제자리를 지키고, placed 는 「바로 앞 컬럼」 사슬로
 * 매달린다. 한 자리를 두 컬럼이 가리키거나 사슬이 닫히면 멈춘다.
 */
function resolveOrder(p: SchemaProjection, t: ProjTable, placed: { id: string; after: string | null }[], fail: Fail): string[] {
  const placedIds = new Set(placed.map((x) => x.id))
  const byName = new Map<string, string>()
  for (const c of Object.values(p.columns)) {
    if (c.tableId !== t.id) continue
    if (byName.has(c.name)) fail(`${t.name} 테이블에 ${c.name} 컬럼이 둘 이상입니다`)
    byName.set(c.name, c.id)
  }
  const FIRST = '\u0000first'
  const children = new Map<string, string>()
  for (const x of placed) {
    const key = x.after === null ? FIRST : (byName.get(x.after) ?? fail(`${t.name} 테이블에 ${x.after} 컬럼이 없습니다(after)`))
    if (children.has(key)) fail(`${t.name} 테이블에서 두 컬럼이 같은 자리(${x.after ?? 'first'})를 가리킵니다`)
    children.set(key, x.id)
  }
  const order: string[] = []
  const chain = (from: string) => {
    let key = from
    for (;;) {
      const next = children.get(key)
      if (next === undefined) return
      children.delete(key)
      order.push(next)
      key = next
    }
  }
  chain(FIRST)
  for (const id of t.columnIds) {
    if (placedIds.has(id)) continue
    order.push(id)
    chain(id)
  }
  if (children.size > 0) fail(`${t.name} 테이블의 컬럼 순서를 정할 수 없습니다 — after 가 서로를 가리킵니다`)
  return order
}

function addColumnEntity(p: SchemaProjection, tableId: string, def: ColumnDef, fail: Fail): void {
  if (p.columns[def.id] !== undefined) fail(`만들 컬럼 @${def.id}(${def.name}) 이(가) 이미 있습니다`)
  p.columns[def.id] = { ...def, tableId, dialectTypes: { ...def.dialectTypes }, check: [...def.check] }
}

function columnOf(p: SchemaProjection, t: ProjTable, id: string, name: string, fail: Fail): ProjColumn {
  const col = p.columns[id]
  if (col === undefined || col.tableId !== t.id) fail(`${t.name} 테이블에 컬럼 @${id}(${name}) 이(가) 없습니다`)
  return col
}

function tableByName(p: SchemaProjection, name: string, fail: Fail): ProjTable {
  const found = Object.values(p.tables).filter((t) => t.name === name)
  if (found.length === 0) fail(`테이블 ${name} 이(가) 없습니다`)
  if (found.length > 1) fail(`같은 이름의 테이블이 둘 이상입니다: ${name}`)
  return found[0]!
}

/** 추가만 되고 아직 순서가 정해지지 않은 컬럼도 찾는다(columnIds 가 아니라 소속으로 본다). */
function columnIdByName(p: SchemaProjection, t: ProjTable, name: string, fail: Fail): string {
  const found = Object.values(p.columns).filter((c) => c.tableId === t.id && c.name === name)
  if (found.length === 0) fail(`${t.name} 테이블에 ${name} 컬럼이 없습니다`)
  if (found.length > 1) fail(`${t.name} 테이블에 ${name} 컬럼이 둘 이상입니다`)
  return found[0]!.id
}
