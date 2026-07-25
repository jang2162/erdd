import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import {
  OpApplyError, type Column, type Domain, type IndexDef, type Note, type Op, type ProjectModel,
  type Relationship, type Table, type TableGroup,
} from '@erdd/core'
import * as schema from '../db/schema.js'
import {
  modelColumns, modelDomains, modelIndexes, modelNotes, modelRelationships, modelTableGroups,
  modelTables,
} from '../db/schema.js'

/** Db와 drizzle 트랜잭션 객체가 공유하는 쿼리 인터페이스. */
export type DbLike = Pick<
  NodePgDatabase<typeof schema>, 'select' | 'insert' | 'update' | 'delete' | 'execute'
>

const TABLE_BY_KIND = {
  tableGroup: modelTableGroups,
  table: modelTables,
  column: modelColumns,
  relationship: modelRelationships,
  index: modelIndexes,
  note: modelNotes,
  domain: modelDomains,
} as const

function keyed<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]))
}

export async function loadProjectModel(db: DbLike, projectId: string): Promise<ProjectModel> {
  const groupRows = await db.select().from(modelTableGroups)
    .where(eq(modelTableGroups.projectId, projectId))
  const tableRows = await db.select().from(modelTables)
    .where(eq(modelTables.projectId, projectId))
  const columnRows = await db.select().from(modelColumns)
    .where(eq(modelColumns.projectId, projectId))
  const relRows = await db.select().from(modelRelationships)
    .where(eq(modelRelationships.projectId, projectId))
  const indexRows = await db.select().from(modelIndexes)
    .where(eq(modelIndexes.projectId, projectId))
  const noteRows = await db.select().from(modelNotes)
    .where(eq(modelNotes.projectId, projectId))
  const domainRows = await db.select().from(modelDomains)
    .where(eq(modelDomains.projectId, projectId))

  return {
    tableGroups: keyed(groupRows.map((r): TableGroup => ({
      id: r.id, name: r.name, color: r.color, comment: r.comment,
    }))),
    tables: keyed(tableRows.map((r): Table => ({
      id: r.id, logicalName: r.logicalName, physicalName: r.physicalName,
      comment: r.comment, groupId: r.groupId, position: r.position,
      groupPosition: r.groupPosition ?? null,
    }))),
    columns: keyed(columnRows.map((r): Column => ({
      id: r.id, tableId: r.tableId, logicalName: r.logicalName, physicalName: r.physicalName,
      type: r.type, isPk: r.isPk, autoIncrement: r.autoIncrement, nullable: r.nullable,
      defaultValue: r.defaultValue, order: r.order, comment: r.comment,
      domainId: r.domainId,
    }))),
    relationships: keyed(relRows.map((r): Relationship => ({
      id: r.id, parentTableId: r.parentTableId, childTableId: r.childTableId,
      columnMappings: r.columnMappings, cardinality: r.cardinality,
      identifying: r.identifying, name: r.name,
    }))),
    indexes: keyed(indexRows.map((r): IndexDef => ({
      id: r.id, tableId: r.tableId, name: r.name, columns: r.columns, unique: r.unique,
    }))),
    notes: keyed(noteRows.map((r): Note => ({
      id: r.id, content: r.content, position: r.position, color: r.color,
    }))),
    domains: keyed(domainRows.map((r): Domain => ({
      id: r.id, name: r.name, category: r.category, logicalType: r.logicalType,
      dialectTypes: r.dialectTypes, defaultValue: r.defaultValue,
      allowedValues: r.allowedValues, description: r.description,
    }))),
    // TODO(Task 4): model_words/model_terms 테이블에서 실로드로 교체.
    words: {},
    terms: {},
  }
}

/**
 * op 배치를 행 단위 SQL로 적용한다.
 * 계약: 호출 전에 반드시 core `applyOps`로 같은 배치가 검증(스키마·무결성)되어 있어야 한다.
 * 모든 조건에 projectId 스코프를 포함해 타 프로젝트 행 접근을 차단한다.
 */
export async function persistOps(
  db: DbLike, projectId: string, ops: readonly Op[],
): Promise<void> {
  for (const op of ops) {
    if (op.entity === 'word' || op.entity === 'term') {
      // TODO(Task 4): model_words/model_terms 테이블 추가 + TABLE_BY_KIND 등록.
      throw new OpApplyError(`${op.entity} 영속화는 아직 구현되지 않음(Task 4)`)
    }
    // 유니언 테이블에 대한 캐스트 — 필드명이 모델 속성과 1:1이고 applyOps가 선검증한다.
    const table = TABLE_BY_KIND[op.entity] as typeof modelNotes
    if (op.action === 'create') {
      await db.insert(table).values({ ...(op.data as object), projectId } as never)
    } else if (op.action === 'update') {
      const patch: Record<string, unknown> = {}
      for (const [prop, change] of Object.entries(op.changes)) patch[prop] = change.to
      // 심층 방어 — applyOps 계약을 우회한 호출이 있어도 소유권/identity 필드는 불변
      delete patch.id
      delete patch.projectId
      await db.update(table).set(patch as never)
        .where(and(eq(table.id, op.entityId), eq(table.projectId, projectId)))
    } else {
      await db.delete(table)
        .where(and(eq(table.id, op.entityId), eq(table.projectId, projectId)))
    }
  }
}
