import type { z } from 'zod'
import {
  ColumnSchema, IndexSchema, NoteSchema, RelationshipSchema, TableGroupSchema, TableSchema,
  type ProjectModel,
} from './model.js'
import { validateModelIntegrity } from './integrity.js'

export const ENTITY_KINDS = ['tableGroup', 'table', 'column', 'relationship', 'index', 'note'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

const ENTITY_SCHEMAS: Record<EntityKind, z.ZodType> = {
  tableGroup: TableGroupSchema,
  table: TableSchema,
  column: ColumnSchema,
  relationship: RelationshipSchema,
  index: IndexSchema,
  note: NoteSchema,
}

export const COLLECTION_BY_KIND = {
  tableGroup: 'tableGroups',
  table: 'tables',
  column: 'columns',
  relationship: 'relationships',
  index: 'indexes',
  note: 'notes',
} as const satisfies Record<EntityKind, keyof ProjectModel>

// from/before는 기록용이다. applyOps는 전제조건으로 검사하지 않는다(Phase 3 LWW에서
// from 불일치는 정상). M3 서버 파이프라인이 영속화 전에 서버의 현재 값으로 재기록한다.
export type CreateOp = { action: 'create'; entity: EntityKind; entityId: string; data: unknown }
export type UpdateOp = {
  action: 'update'
  entity: EntityKind
  entityId: string
  changes: Record<string, { from: unknown; to: unknown }>
}
export type DeleteOp = { action: 'delete'; entity: EntityKind; entityId: string; before: unknown }
export type Op = CreateOp | UpdateOp | DeleteOp

export class OpApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpApplyError'
  }
}

/**
 * op 배치를 적용한 새 모델을 반환한다. 입력 모델은 변경하지 않는다.
 * 배치는 원자 단위로 적용되며, 무결성 검사는 배치 전체를 적용한 뒤 단 한 번만 수행한다.
 * diffModels가 만든 배치를 op 단위로 쪼개 개별 적용하면 캐스케이드 삭제/생성 도중
 * 중간 상태가 무결성 검사에 걸려 실패할 수 있다.
 */
export function applyOps(model: ProjectModel, ops: readonly Op[]): ProjectModel {
  const next: ProjectModel = {
    tables: { ...model.tables },
    columns: { ...model.columns },
    relationships: { ...model.relationships },
    indexes: { ...model.indexes },
    notes: { ...model.notes },
    tableGroups: { ...model.tableGroups },
  }

  ops.forEach((op, i) => {
    const collection = next[COLLECTION_BY_KIND[op.entity]] as Record<string, { id: string }>
    const label = `op[${i}] ${op.action} ${op.entity} ${op.entityId}`

    if (op.action === 'create') {
      if (op.entityId === '__proto__') throw new OpApplyError(`${label}: 허용되지 않는 id`)
      if (Object.hasOwn(collection, op.entityId)) throw new OpApplyError(`${label}: 이미 존재함`)
      const parsed = ENTITY_SCHEMAS[op.entity].safeParse(op.data)
      if (!parsed.success) throw new OpApplyError(`${label}: 데이터 형식 오류 — ${parsed.error.message}`)
      const entity = parsed.data as { id: string }
      if (entity.id !== op.entityId) throw new OpApplyError(`${label}: data.id(${entity.id}) 불일치`)
      collection[op.entityId] = entity
    } else if (op.action === 'update') {
      if (!Object.hasOwn(collection, op.entityId)) throw new OpApplyError(`${label}: 존재하지 않음`)
      const current = collection[op.entityId]!
      const updated: Record<string, unknown> = { ...current }
      for (const [prop, change] of Object.entries(op.changes)) {
        if (prop === 'id') throw new OpApplyError(`${label}: id는 변경할 수 없음`)
        updated[prop] = change.to
      }
      const parsed = ENTITY_SCHEMAS[op.entity].safeParse(updated)
      if (!parsed.success) throw new OpApplyError(`${label}: 갱신 결과 형식 오류 — ${parsed.error.message}`)
      collection[op.entityId] = parsed.data as { id: string }
    } else {
      if (!Object.hasOwn(collection, op.entityId)) throw new OpApplyError(`${label}: 존재하지 않음`)
      delete collection[op.entityId]
    }
  })

  const issues = validateModelIntegrity(next)
  if (issues.length > 0) {
    const summary = issues.map((it) => `${it.entity} ${it.entityId}: ${it.message}`).join('; ')
    throw new OpApplyError(`배치 적용 결과 무결성 위반 — ${summary}`)
  }

  return next
}
