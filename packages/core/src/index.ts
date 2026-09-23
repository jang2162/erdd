export { parseLogicalType, canonicalOf, isUnsignedCapable } from './logical-type.js'
export type { LogicalType, LogicalTypeKind, ParseResult, UnsignedCapableKind } from './logical-type.js'
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
export { diffModelsForDisplay, DIFF_KIND_LABEL, CHANGE_KIND_LABEL } from './model-diff.js'
export type { ModelDiff, DiffEntry, DiffFieldChange, DiffChangeKind } from './model-diff.js'
export {
  DEFAULT_TABLE_OPTIONS, TableOptionsSchema, TableOptionsStrictSchema,
} from './table-options.js'
export type { TableOptions } from './table-options.js'
export { DIALECTS, toDialectType, fromDialectType, resolveColumnType, unsignedWarning } from './dialect.js'
export type { Dialect, FromDialectResult } from './dialect.js'
export { quoteIdentifier, isReservedWord } from './identifier.js'
export { generateDdl, ddlWarnings } from './ddl.js'
export type { DdlScope, ExportScope } from './ddl.js'
export { generateDbml, DBML_DATABASE_TYPE } from './dbml.js'
export {
  EXCEL_SHEET_KEYS, EXCEL_SHEET_NAME, WORD_HEADERS, TERM_HEADERS, DOMAIN_HEADERS,
  TABLE_LIST_HEADERS, TABLE_SPEC_HEADERS, CHANGE_HEADERS, buildExcelSheets, buildDictTemplateSheets,
  buildChangeSheet,
} from './excel-sheets.js'
export type { ExcelSheetKey, SheetKey, SheetData } from './excel-sheets.js'
export { DICT_SHEET_KEYS, planDictImport } from './excel-import.js'
export type {
  DictSheetKey, RawSheet, DictImportIssue, DictImportEntry, DictImportCounts,
  DictImportPlan, TermDraft, WordPatch, TermPatch, DomainPatch,
} from './excel-import.js'
export { MAX_OPS_PER_MUTATION, OpParseError, parseOps } from './op-guard.js'
export {
  MAX_PEER_SELECTIONS, PEER_SELECTION_KINDS, PEER_PALETTE, WS_CLOSE_UNAUTHORIZED, WS_CLOSE_FORBIDDEN,
  peerColor, parseServerMessage, parseClientMessage,
} from './realtime-protocol.js'
export type {
  PeerSelectionKind, PeerSelection, Peer, ServerMessage, ClientMessage,
} from './realtime-protocol.js'
export {
  createRelationshipFromParentPk, remapRelationshipChildColumn, setRelationshipIdentifying,
  deleteRelationship, deleteTableCascade, deleteColumnCascade,
  junctionTableName, resolveManyToMany,
} from './relationship.js'
export type { JunctionSpec } from './relationship.js'
export { parseDdl, detectDialect, splitStatements, unquoteIdentifier } from './ddl-parse.js'
export type {
  ParsedColumn, ParsedTable, ParsedConstraint, ParsedIndex, ParsedComment,
  SkippedStatement, ParsedDdl, RawStatement,
} from './ddl-parse.js'
export { parseDbml, dbmlDefaultToRaw, dialectFromDatabaseType } from './dbml-parse.js'
export type { ParsedDbml, ParsedGroup, ParsedCustomValue } from './dbml-parse.js'
export { planDdlImport } from './ddl-import.js'
export { applyDdlImport } from './ddl-apply.js'
export type { LayoutFn } from './ddl-apply.js'
export { GROUP_PALETTE, nextGroupColor } from './group-palette.js'
export type {
  DdlImportWarning, DdlImportColumn, DdlImportTable, DdlImportRelationship, DdlImportGroup,
  DdlImportPlan,
} from './ddl-import.js'
export { createGroup, updateGroup, deleteGroup, setTableGroup } from './group.js'
export { createIndex, updateIndex, removeIndex } from './table-index.js'
export { computeWarnings } from './warnings.js'
export type { Warning } from './warnings.js'
export { resolveColumn } from './domain-resolve.js'
export type { ResolvedColumn } from './domain-resolve.js'
export {
  generatePhysicalName, decomposeByWords, restoreLogicalName, DEFAULT_NAMING_RULES, suggestCompletions,
  NamingRulesSchema, NamingRulesStrictSchema, stripLogicalSeparator, withLogicalSeparator,
} from './naming.js'
export type {
  NamingRules, GenResult, WordSegment, RestoreLogicalResult, Completion, CompletionResult,
} from './naming.js'
export { composeTableLogicalName, composeTablePhysicalName, parseTemplate } from './name-template.js'
export type { TemplateToken } from './name-template.js'
export { serializeNameMeta, parseNameMeta, buildNameMeta } from './name-meta.js'
export type { NameMeta, NameMetaEntry, NameMetaGroup } from './name-meta.js'
export {
  customFieldsFor, resolveCustomValue, customFieldUsageCount, customOptionUsageCount,
} from './custom-field.js'
export {
  RESOURCE_KINDS, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, RESOURCE_PAYLOAD_SCHEMAS,
  resourcePayloadOf, resourceDisplayName, resourceEntitiesOf,
} from './resource.js'
export type { ResourceKind } from './resource.js'
export { planResync, applyResyncPlan, adoptTargetOf, adoptAssignments, planAdoption } from './resource-sync.js'
export type {
  LibraryItem, ResyncStatus, ResyncDecision, ResyncEntry, ResyncPlan, AdoptionPlan,
} from './resource-sync.js'
export { planPromote, applyPromotePlan, danglingDomain } from './resource-promote.js'
export type { PromoteStatus, PromoteEntry, PromotePlan, PromoteWrite } from './resource-promote.js'
export {
  modelToFiles, filesToModel, tableFileName, unsafeFileName, TREE_ROOT, TOP_LEVEL_FILES, ORIGINS_FILE,
  NEW_ID_PREFIX, isNewId,
} from './file-format.js'
export type { FileTree, FileIssue, FilesToModelResult, FilesToModelOptions } from './file-format.js'
export {
  MERGE_KINDS, FILE_FIELDS, FILE_INVISIBLE_FIELDS, fileVisibleModel, mergeModels,
  applyMerge, pruneDangling, gridPositions, entityDisplayName,
} from './file-merge.js'
export type {
  MergeKind, MergeConflict, MergeResult, MergeOptions, ConflictReason, PrunedRef,
} from './file-merge.js'
export {
  applyLayout, layoutFromModel,
} from './layout.js'
export type { LayoutData, TableLayout } from './layout.js'
export { LOCAL_PROJECT_ID, type RunMode } from './local.js'
export {
  LOCAL_EVENTS_PATH, LOCAL_SAVE_PATH, LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, parseLocalEvent,
  LOCAL_CHANGES_PATH, LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_UNSAVED_MESSAGE, LOCAL_CHANGES_LOCAL_ONLY_MESSAGE,
} from './local-protocol.js'
export type {
  LocalEvent, LocalLoadFailure, LocalSaveResult, LocalChangesStatus, LocalChangesCreateResult,
} from './local-protocol.js'
export { projectSchema } from './changeset/projection.js'
export type { ProjectionSettings } from './changeset/projection.js'
export { diffProjection, longestCommonSubsequence } from './changeset/diff.js'
export type { DiffProjectionResult } from './changeset/diff.js'
export { formatChangeset, formatStatements, CHANGESET_BANNER } from './changeset/format.js'
export { parseChangeset } from './changeset/parse.js'
export type { ParseChangesetResult } from './changeset/parse.js'
export { applyChangeset, replay, ReplayFailure } from './changeset/replay.js'
export type { ChangesetRecord, ReplayResult, ReplayWarning } from './changeset/replay.js'
export {
  planChanges, composeChangeset, changesetStamp, changesetFileName, stampToIso, formatChangeIssue,
  CHANGESET_EXT,
} from './changeset/plan.js'
export type {
  ChangesetSource, ChangeRecordSummary, ChangesPlan, PlanInput, ComposeOptions, ComposeResult,
  ComposeFailureReason,
} from './changeset/plan.js'
export { CHANGESET_FORMAT, emptyProjection, compareCodeUnits } from './changeset/types.js'
export type {
  SchemaProjection, ProjTable, ProjColumn, ProjIndex, ProjForeignKey, DialectTypes, ColumnDef,
  IndexDef as ChangesetIndexDef, ForeignKeyDef, TableDef, ColumnChange, AlterAction, Statement,
  Changeset, ChangesetHeader, ChangeIssue,
} from './changeset/types.js'
export {
  LIBRARY_FILE_FORMAT, LIBRARY_FILE_VERSION, LIBRARY_FILE_EXTENSION, MAX_LIBRARY_FILE_ITEMS,
  parseLibraryFile, stringifyLibraryFile, exportLibraryFile, libraryItemsOf, formatLibraryFileIssues,
} from './library-file.js'
export type {
  LibraryFileEntry, LibraryFileMeta, LibraryFileDoc, LibraryFileStrictness, LibraryFileIssue,
} from './library-file.js'
