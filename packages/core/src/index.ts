export { parseLogicalType } from './logical-type.js'
export type { LogicalType, LogicalTypeKind, ParseResult } from './logical-type.js'
export {
  PositionSchema, TableSchema, ColumnSchema, RelationshipSchema,
  IndexSchema, NoteSchema, TableGroupSchema, DomainSchema, WordSchema, TermSchema,
  CustomFieldSchema, ProjectModelSchema, createEmptyModel, OriginSchema,
} from './model.js'
export type {
  Position, Table, Column, Relationship, IndexDef, Note, TableGroup, Domain, Word, Term,
  CustomField, ProjectModel, Origin,
} from './model.js'
export { validateModelIntegrity } from './integrity.js'
export type { IntegrityIssue } from './integrity.js'
export { COLLECTION_BY_KIND, ENTITY_KINDS, OpApplyError, applyOps } from './op.js'
export type { CreateOp, UpdateOp, DeleteOp, Op, EntityKind } from './op.js'
export { invertOp, invertOps } from './invert.js'
export { deepEqual } from './equal.js'
export { diffModels } from './diff.js'
export { DIALECTS, toDialectType, resolveColumnType } from './dialect.js'
export type { Dialect } from './dialect.js'
export { quoteIdentifier, isReservedWord } from './identifier.js'
export { generateDdl, ddlWarnings } from './ddl.js'
export type { DdlScope } from './ddl.js'
export { OpParseError, parseOps } from './op-guard.js'
export {
  createRelationshipFromParentPk, remapRelationshipChildColumn, setRelationshipIdentifying,
  deleteRelationship, deleteTableCascade, deleteColumnCascade,
} from './relationship.js'
export { createGroup, updateGroup, deleteGroup, setTableGroup } from './group.js'
export { createIndex, updateIndex, removeIndex } from './table-index.js'
export { computeWarnings } from './warnings.js'
export type { Warning } from './warnings.js'
export { resolveColumn } from './domain-resolve.js'
export type { ResolvedColumn } from './domain-resolve.js'
export { generatePhysicalName, DEFAULT_NAMING_RULES } from './naming.js'
export type { NamingRules, GenResult } from './naming.js'
export {
  customFieldsFor, resolveCustomValue, customFieldUsageCount, customOptionUsageCount,
} from './custom-field.js'
export {
  RESOURCE_KINDS, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, RESOURCE_PAYLOAD_SCHEMAS,
  resourcePayloadOf, resourceDisplayName,
} from './resource.js'
export type { ResourceKind } from './resource.js'
export { planResync, applyResyncPlan } from './resource-sync.js'
export type {
  LibraryItem, ResyncStatus, ResyncDecision, ResyncEntry, ResyncPlan,
} from './resource-sync.js'
