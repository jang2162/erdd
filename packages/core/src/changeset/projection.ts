import {
  commentText, effectiveAutoIncrement, exportableTables, relationshipConstraintNames, tableColumns,
} from '../ddl.js'
import type { Dialect } from '../dialect.js'
import { resolveColumn } from '../domain-resolve.js'
import type { Column, ProjectModel } from '../model.js'
import { composeTableLogicalName, composeTablePhysicalName } from '../name-template.js'
import type { NamingRules } from '../naming.js'
import { emptyProjection, type DialectTypes, type ProjColumn, type SchemaProjection } from './types.js'

export type ProjectionSettings = { rules: NamingRules; dialects: readonly Dialect[] }

/**
 * 모델 → 스키마 투영. 기록·재생·비교는 모두 이 모양 위에서만 일어난다
 * (guide 「기록 대상 — 스키마 투영」).
 *
 * ⚠️ **DDL 내보내기와 같은 함수로 판정·이름을 만든다** — 나가는 테이블(`exportableTables`), 물리명
 * (`composeTablePhysicalName`), FK·UNIQUE 이름(`relationshipConstraintNames`), 코멘트
 * (`commentText`), 자동증가(`effectiveAutoIncrement`). 사본을 두면 기록과 내보내기가 조용히 다른
 * 이름을 말한다.
 */
export function projectSchema(model: ProjectModel, settings: ProjectionSettings): SchemaProjection {
  const out = emptyProjection()
  const tables = exportableTables(model, { kind: 'all' }, settings.rules)
  const selected = new Set(tables.map((t) => t.id))

  for (const t of tables) {
    const name = composeTablePhysicalName(t, model, settings.rules)
    const cols = tableColumns(model, t.id)
    out.tables[t.id] = {
      id: t.id,
      name,
      comment: commentText(composeTableLogicalName(t, model, settings.rules), name, t.comment),
      columnIds: cols.map((c) => c.id),
      primaryKey: cols.filter((c) => c.isPk).map((c) => c.id),
    }
    for (const c of cols) out.columns[c.id] = projectColumn(c, model, settings.dialects)
  }

  for (const ix of Object.values(model.indexes)) {
    if (!selected.has(ix.tableId)) continue
    out.indexes[ix.id] = {
      id: ix.id, tableId: ix.tableId, name: ix.name,
      columns: ix.columns.map((c) => ({ columnId: c.columnId, direction: c.direction })),
      unique: ix.unique,
    }
  }

  const names = relationshipConstraintNames(model, selected, settings.rules)
  for (const rel of Object.values(model.relationships)) {
    const n = names.get(rel.id)
    if (n === undefined) continue
    out.foreignKeys[rel.id] = {
      id: rel.id,
      name: n.fk,
      childTableId: rel.childTableId,
      childColumnIds: rel.columnMappings.map((m) => m.childColumnId),
      parentTableId: rel.parentTableId,
      parentColumnIds: rel.columnMappings.map((m) => m.parentColumnId),
      cardinality: rel.cardinality,
      uniqueName: n.unique,
    }
  }
  return out
}

function projectColumn(c: Column, model: ProjectModel, dialects: readonly Dialect[]): ProjColumn {
  // resolveColumn 의 논리 타입·기본값·허용값은 방언과 무관하다 — 방언 인자는 물리 타입(sql)만 바꾸고,
  // 물리 타입은 기록에 싣지 않는다(DB 중립). 방언별 타입은 아래에서 도메인 오버라이드만 따로 싣는다.
  const r = resolveColumn(c, model, 'postgresql')
  const domain = c.domainId === null ? undefined : model.domains[c.domainId]
  const dialectTypes: DialectTypes = {}
  if (domain !== undefined) {
    for (const d of dialects) {
      const v = domain.dialectTypes[d]?.trim() ?? ''
      if (v !== '') dialectTypes[d] = v
    }
  }
  const increment = effectiveAutoIncrement(c, r.logicalType)
  return {
    id: c.id,
    tableId: c.tableId,
    name: c.physicalName,
    type: r.logicalType,
    dialectTypes,
    nullable: c.nullable,
    // DDL 은 자동증가 컬럼에 DEFAULT 를 내지 않는다 — 같은 판정.
    default: increment || r.defaultValue === null || r.defaultValue === '' ? null : r.defaultValue,
    increment,
    comment: commentText(c.logicalName, c.physicalName, c.comment),
    check: r.checkValues ?? [],
  }
}
