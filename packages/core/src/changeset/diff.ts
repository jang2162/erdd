import { deepEqual } from '../equal.js'
import {
  compareCodeUnits,
  type AlterAction, type ColumnChange, type ColumnDef, type ForeignKeyDef, type IndexDef,
  type ProjColumn, type ProjForeignKey, type ProjIndex, type ProjTable, type SchemaProjection,
  type Statement, type TableDef,
} from './types.js'

export type DiffProjectionResult =
  | { ok: true; statements: Statement[] }
  | { ok: false; message: string }

/**
 * 기준선 → 현재의 차이를 기록 문장으로 낸다. 순서는 guide 「문장 순서」 그대로다 — 위에서 아래로
 * SQL 로 옮겨 써도 의존성이 맞는다.
 *
 * ⚠️ 모델 diff(`diffModels`·`diffModelsForDisplay`)와 섞지 마라. 저 둘은 모델 전체가 대상이고
 * 용도가 고정돼 있다. 이 함수는 스키마 투영만 본다.
 */
export function diffProjection(base: SchemaProjection, target: SchemaProjection): DiffProjectionResult {
  const refusal = refusalOf(base, target)
  if (refusal !== null) return { ok: false, message: refusal }
  const out: Statement[] = []

  // 1. FK 삭제 — 내용이 바뀐 FK 도 지웠다가 8번에서 다시 만든다(대부분의 DB 가 FK 를 고치지 못한다).
  for (const fk of sortedForeignKeys(base)) {
    const next = target.foreignKeys[fk.id]
    if (next === undefined || !deepEqual(fk, next)) out.push({ kind: 'dropForeignKey', fk: foreignKeyDef(base, fk) })
  }
  // 2. 인덱스 삭제·개명 — 사라지는 테이블의 인덱스는 3번 drop table 블록이 싣는다.
  for (const ix of sortedIndexes(base)) {
    if (target.tables[ix.tableId] === undefined) continue
    const next = target.indexes[ix.id]
    if (next === undefined || !sameIndexContent(ix, next)) {
      out.push({ kind: 'dropIndex', index: indexDef(base, ix) })
    } else if (next.name !== ix.name) {
      out.push({ kind: 'renameIndex', id: ix.id, table: base.tables[ix.tableId]!.name, from: ix.name, to: next.name })
    }
  }
  // 3. 테이블 삭제 — 개명·생성보다 먼저여야 「지운 테이블의 이름」을 곧바로 쓸 수 있다.
  for (const t of sortedTables(base)) {
    if (target.tables[t.id] === undefined) out.push({ kind: 'dropTable', table: tableDef(base, t, true) })
  }
  // 4. 테이블 개명
  for (const t of sortedTables(base)) {
    const next = target.tables[t.id]
    if (next !== undefined && next.name !== t.name) out.push({ kind: 'renameTable', id: t.id, from: t.name, to: next.name })
  }
  // 5. 테이블 생성
  for (const t of sortedTables(target)) {
    if (base.tables[t.id] === undefined) out.push({ kind: 'createTable', table: tableDef(target, t, false) })
  }
  // 6. 테이블 변경
  for (const t of sortedTables(target)) {
    const prev = base.tables[t.id]
    if (prev === undefined) continue
    const actions = alterActions(base, target, prev, t)
    if (actions.length > 0) out.push({ kind: 'alterTable', id: t.id, name: t.name, actions })
  }
  // 7. 인덱스 추가
  for (const ix of sortedIndexes(target)) {
    const prev = base.indexes[ix.id]
    if (prev === undefined || !sameIndexContent(prev, ix)) out.push({ kind: 'addIndex', index: indexDef(target, ix) })
  }
  // 8. FK 추가
  for (const fk of sortedForeignKeys(target)) {
    const prev = base.foreignKeys[fk.id]
    if (prev === undefined || !deepEqual(prev, fk)) out.push({ kind: 'addForeignKey', fk: foreignKeyDef(target, fk) })
  }
  return { ok: true, statements: out }
}

/**
 * 기록을 만들 수 없는 상태(guide 「기록을 만들 수 없는 경우」). 재생이 FK·인덱스·PK·`after` 를
 * **이름으로** 풀기 때문에 같은 이름이 둘이면 어느 쪽인지 정할 수 없다. 컬럼의 소속 이동은
 * 문장으로 표현할 자리가 없다(drop 과 add 가 다른 테이블 블록에 흩어져 순서를 보장할 수 없다).
 */
function refusalOf(base: SchemaProjection, target: SchemaProjection): string | null {
  const tableNames = new Set<string>()
  for (const t of Object.values(target.tables)) {
    if (tableNames.has(t.name)) return `같은 물리명의 테이블이 둘 있습니다: ${t.name} — 이름을 고친 뒤 기록하세요`
    tableNames.add(t.name)
    const columnNames = new Set<string>()
    for (const id of t.columnIds) {
      const c = target.columns[id]!
      if (columnNames.has(c.name)) return `${t.name} 테이블에 같은 물리명의 컬럼이 둘 있습니다: ${c.name} — 이름을 고친 뒤 기록하세요`
      columnNames.add(c.name)
    }
  }
  for (const c of Object.values(target.columns)) {
    const prev = base.columns[c.id]
    if (prev !== undefined && prev.tableId !== c.tableId) {
      const from = base.tables[prev.tableId]?.name ?? prev.tableId
      const to = target.tables[c.tableId]?.name ?? c.tableId
      return `컬럼 ${from}.${prev.name} 이(가) 다른 테이블(${to})로 옮겨졌습니다 — 옮긴 컬럼은 id 를 지워 새 컬럼으로 만드세요`
    }
  }
  return null
}

function alterActions(base: SchemaProjection, target: SchemaProjection, prev: ProjTable, next: ProjTable): AlterAction[] {
  const actions: AlterAction[] = []
  const inNext = new Set(next.columnIds)
  const inPrev = new Set(prev.columnIds)
  const nameNow = (id: string) => target.columns[id]?.name ?? base.columns[id]!.name

  for (const id of prev.columnIds) {
    if (!inNext.has(id)) actions.push({ kind: 'dropColumn', column: columnDef(base.columns[id]!) })
  }
  for (const id of next.columnIds) {
    if (!inPrev.has(id)) continue
    const a = base.columns[id]!
    const b = target.columns[id]!
    if (a.name !== b.name) actions.push({ kind: 'renameColumn', id, from: a.name, to: b.name })
  }
  // 옮겨진 컬럼 = 양쪽에 다 있지만 최장 공통 부분열에 들지 못한 것(guide 「`after` 는 최종 순서의 바로 앞 컬럼이다」).
  const stable = new Set(longestCommonSubsequence(
    prev.columnIds.filter((id) => inNext.has(id)),
    next.columnIds.filter((id) => inPrev.has(id)),
  ))
  const predecessor = (list: readonly string[], i: number): string | null => (i <= 0 ? null : nameNow(list[i - 1]!))
  next.columnIds.forEach((id, i) => {
    if (!inPrev.has(id)) actions.push({ kind: 'addColumn', column: columnDef(target.columns[id]!), after: predecessor(next.columnIds, i) })
  })
  next.columnIds.forEach((id, i) => {
    if (!inPrev.has(id)) return
    const changes = columnChanges(base.columns[id]!, target.columns[id]!)
    if (!stable.has(id)) {
      changes.push({ field: 'position', from: predecessor(prev.columnIds, prev.columnIds.indexOf(id)), to: predecessor(next.columnIds, i) })
    }
    if (changes.length > 0) actions.push({ kind: 'modifyColumn', id, name: target.columns[id]!.name, changes })
  })
  // 지운 PK 컬럼은 drop column 이 PK 에서도 뺀다 — 비교는 그 뒤의 상태와 한다.
  const prevPk = prev.primaryKey.filter((id) => inNext.has(id))
  if (!deepEqual(prevPk, next.primaryKey)) {
    actions.push({ kind: 'primaryKey', from: prevPk.map(nameNow), to: next.primaryKey.map(nameNow) })
  }
  if (prev.comment !== next.comment) actions.push({ kind: 'tableComment', from: prev.comment, to: next.comment })
  return actions
}

function columnChanges(a: ProjColumn, b: ProjColumn): ColumnChange[] {
  const out: ColumnChange[] = []
  if (a.type !== b.type) out.push({ field: 'type', from: a.type, to: b.type })
  if (!deepEqual(a.dialectTypes, b.dialectTypes)) out.push({ field: 'dialects', from: { ...a.dialectTypes }, to: { ...b.dialectTypes } })
  if (a.nullable !== b.nullable) out.push({ field: 'nullable', from: a.nullable, to: b.nullable })
  if (a.default !== b.default) out.push({ field: 'default', from: a.default, to: b.default })
  if (a.increment !== b.increment) out.push({ field: 'increment', from: a.increment, to: b.increment })
  if (a.comment !== b.comment) out.push({ field: 'comment', from: a.comment, to: b.comment })
  if (!deepEqual(a.check, b.check)) out.push({ field: 'check', from: [...a.check], to: [...b.check] })
  return out
}

/** 최장 공통 부분열. 한 테이블의 컬럼 수 정도라 O(n·m) 로 충분하다. */
export function longestCommonSubsequence(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(a[i]!); i += 1; j += 1 }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1
    else j += 1
  }
  return out
}

const byName = <T extends { name: string; id: string }>(a: T, b: T) =>
  compareCodeUnits(a.name, b.name) || compareCodeUnits(a.id, b.id)

function sortedTables(p: SchemaProjection): ProjTable[] {
  return Object.values(p.tables).sort(byName)
}
function sortedIndexes(p: SchemaProjection): ProjIndex[] {
  return Object.values(p.indexes).sort((a, b) =>
    compareCodeUnits(p.tables[a.tableId]?.name ?? '', p.tables[b.tableId]?.name ?? '') || byName(a, b))
}
function sortedForeignKeys(p: SchemaProjection): ProjForeignKey[] {
  return Object.values(p.foreignKeys).sort(byName)
}
function sameIndexContent(a: ProjIndex, b: ProjIndex): boolean {
  return a.tableId === b.tableId && a.unique === b.unique && deepEqual(a.columns, b.columns)
}

function columnDef(c: ProjColumn): ColumnDef {
  return {
    id: c.id, name: c.name, type: c.type, dialectTypes: { ...c.dialectTypes }, nullable: c.nullable,
    default: c.default, increment: c.increment, comment: c.comment, check: [...c.check],
  }
}
const columnName = (p: SchemaProjection, id: string) => p.columns[id]?.name ?? id
const tableName = (p: SchemaProjection, id: string) => p.tables[id]?.name ?? id

function indexDef(p: SchemaProjection, ix: ProjIndex): IndexDef {
  return {
    id: ix.id, name: ix.name, table: tableName(p, ix.tableId),
    columns: ix.columns.map((c) => ({ name: columnName(p, c.columnId), direction: c.direction })),
    unique: ix.unique,
  }
}
function foreignKeyDef(p: SchemaProjection, fk: ProjForeignKey): ForeignKeyDef {
  return {
    id: fk.id, name: fk.name,
    child: tableName(p, fk.childTableId), childColumns: fk.childColumnIds.map((id) => columnName(p, id)),
    parent: tableName(p, fk.parentTableId), parentColumns: fk.parentColumnIds.map((id) => columnName(p, id)),
    cardinality: fk.cardinality, uniqueName: fk.uniqueName,
  }
}
function tableDef(p: SchemaProjection, t: ProjTable, withIndexes: boolean): TableDef {
  return {
    id: t.id, name: t.name, comment: t.comment,
    columns: t.columnIds.map((id) => columnDef(p.columns[id]!)),
    primaryKey: t.primaryKey.map((id) => columnName(p, id)),
    indexes: withIndexes ? sortedIndexes(p).filter((ix) => ix.tableId === t.id).map((ix) => indexDef(p, ix)) : [],
  }
}
