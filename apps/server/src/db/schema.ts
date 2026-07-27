import {
  boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { DEFAULT_NAMING_RULES, type Dialect, type NamingRules, type Op, type ProjectModel } from '@erdd/core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['personal', 'team'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ux_members_org_user').on(t.orgId, t.userId)],
)

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  dialects: jsonb('dialects').$type<Dialect[]>().notNull(),
  namingRules: jsonb('naming_rules').$type<NamingRules>().notNull().default(DEFAULT_NAMING_RULES),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ux_project_members_project_member').on(t.projectId, t.memberId)],
)

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── 프로젝트 모델 상태 테이블 (packages/core ProjectModel과 1:1) ───

export const modelTableGroups = pgTable('model_table_groups', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),
  comment: text('comment'),
})

export const modelTables = pgTable('model_tables', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logicalName: text('logical_name').notNull(),
  physicalName: text('physical_name').notNull(),
  comment: text('comment'),
  groupId: uuid('group_id').references(() => modelTableGroups.id),
  position: jsonb('position').$type<{ x: number; y: number }>().notNull(),
  groupPosition: jsonb('group_position').$type<{ x: number; y: number }>(),
  custom: jsonb('custom').$type<Record<string, string>>().notNull().default({}),
})

export const modelColumns = pgTable('model_columns', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => modelTables.id),
  logicalName: text('logical_name').notNull(),
  physicalName: text('physical_name').notNull(),
  type: text('type').notNull(),
  isPk: boolean('is_pk').notNull(),
  autoIncrement: boolean('auto_increment').notNull(),
  nullable: boolean('nullable').notNull(),
  defaultValue: text('default_value'),
  order: integer('order').notNull(),
  comment: text('comment'),
  domainId: uuid('domain_id').references(() => modelDomains.id),
  custom: jsonb('custom').$type<Record<string, string>>().notNull().default({}),
})

export const modelDomains = pgTable('model_domains', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  logicalType: text('logical_type').notNull(),
  dialectTypes: jsonb('dialect_types')
    .$type<{ postgresql: string | null; mysql: string | null; oracle: string | null; mssql: string | null }>().notNull(),
  defaultValue: text('default_value'),
  allowedValues: jsonb('allowed_values').$type<string[]>().notNull(),
  description: text('description'),
})

export const modelWords = pgTable('model_words', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logicalName: text('logical_name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  description: text('description'),
})

export const modelTerms = pgTable('model_terms', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  logicalName: text('logical_name').notNull(),
  physicalName: text('physical_name').notNull(),
  domainId: uuid('domain_id').references(() => modelDomains.id),
  description: text('description'),
})

export const modelCustomFields = pgTable('model_custom_fields', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  target: text('target', { enum: ['table', 'column'] }).notNull(),
  type: text('type', { enum: ['text', 'boolean', 'select'] }).notNull(),
  options: jsonb('options').$type<string[]>().notNull(),
  required: boolean('required').notNull(),
  defaultValue: text('default_value'),
  order: integer('order').notNull(),
})

export const modelRelationships = pgTable('model_relationships', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentTableId: uuid('parent_table_id').notNull().references(() => modelTables.id),
  childTableId: uuid('child_table_id').notNull().references(() => modelTables.id),
  columnMappings: jsonb('column_mappings')
    .$type<Array<{ childColumnId: string; parentColumnId: string }>>().notNull(),
  cardinality: text('cardinality', { enum: ['1:1', '1:N'] }).notNull(),
  identifying: boolean('identifying').notNull(),
  name: text('name'),
})

export const modelIndexes = pgTable('model_indexes', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => modelTables.id),
  name: text('name').notNull(),
  columns: jsonb('columns')
    .$type<Array<{ columnId: string; direction: 'asc' | 'desc' }>>().notNull(),
  unique: boolean('unique').notNull(),
})

export const modelNotes = pgTable('model_notes', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  position: jsonb('position').$type<{ x: number; y: number }>().notNull(),
  color: text('color').notNull(),
})

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
    source: text('source', { enum: ['web', 'cli', 'system'] }).notNull(),
    ops: jsonb('ops').$type<Op[]>().notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ux_revisions_project_seq').on(t.projectId, t.seq)],
)

export const snapshots = pgTable('snapshots', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  revisionSeq: integer('revision_seq').notNull(),
  model: jsonb('model').$type<ProjectModel>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
