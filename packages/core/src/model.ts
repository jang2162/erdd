import { z } from 'zod'

export const PositionSchema = z.strictObject({ x: z.number(), y: z.number() })
export type Position = z.infer<typeof PositionSchema>

export const TableSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),
  physicalName: z.string(),
  comment: z.string().nullable(),
  groupId: z.string().nullable(),
  position: PositionSchema,
  groupPosition: PositionSchema.nullable(),
})
export type Table = z.infer<typeof TableSchema>

export const ColumnSchema = z.strictObject({
  id: z.string(),
  tableId: z.string(),
  logicalName: z.string(),
  physicalName: z.string(),
  type: z.string(),
  isPk: z.boolean(),
  autoIncrement: z.boolean(),
  nullable: z.boolean(),
  defaultValue: z.string().nullable(),
  order: z.number().int(),
  comment: z.string().nullable(),
  domainId: z.string().nullable().default(null),
})
export type Column = z.infer<typeof ColumnSchema>

export const RelationshipSchema = z.strictObject({
  id: z.string(),
  parentTableId: z.string(),
  childTableId: z.string(),
  columnMappings: z.array(
    z.strictObject({ childColumnId: z.string(), parentColumnId: z.string() }),
  ),
  cardinality: z.enum(['1:1', '1:N']),
  identifying: z.boolean(),
  name: z.string().nullable(),
})
export type Relationship = z.infer<typeof RelationshipSchema>

export const IndexSchema = z.strictObject({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  columns: z.array(
    z.strictObject({ columnId: z.string(), direction: z.enum(['asc', 'desc']) }),
  ),
  unique: z.boolean(),
})
export type IndexDef = z.infer<typeof IndexSchema>

export const NoteSchema = z.strictObject({
  id: z.string(),
  content: z.string(),
  position: PositionSchema,
  color: z.string(),
})
export type Note = z.infer<typeof NoteSchema>

export const TableGroupSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  comment: z.string().nullable(),
})
export type TableGroup = z.infer<typeof TableGroupSchema>

export const DomainSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  logicalType: z.string(),
  dialectTypes: z.strictObject({
    postgresql: z.string().nullable(),
    mysql: z.string().nullable(),
    oracle: z.string().nullable(),
    mssql: z.string().nullable(),
  }),
  defaultValue: z.string().nullable(),
  allowedValues: z.array(z.string()),
  description: z.string().nullable(),
})
export type Domain = z.infer<typeof DomainSchema>

export const WordSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),
  abbreviation: z.string(),
  description: z.string().nullable(),
})
export type Word = z.infer<typeof WordSchema>

export const TermSchema = z.strictObject({
  id: z.string(),
  logicalName: z.string(),
  physicalName: z.string(),
  domainId: z.string().nullable(),
  description: z.string().nullable(),
})
export type Term = z.infer<typeof TermSchema>

export const ProjectModelSchema = z.strictObject({
  tables: z.record(z.string(), TableSchema),
  columns: z.record(z.string(), ColumnSchema),
  relationships: z.record(z.string(), RelationshipSchema),
  indexes: z.record(z.string(), IndexSchema),
  notes: z.record(z.string(), NoteSchema),
  tableGroups: z.record(z.string(), TableGroupSchema),
  domains: z.record(z.string(), DomainSchema),
  words: z.record(z.string(), WordSchema).default({}),
  terms: z.record(z.string(), TermSchema).default({}),
})
export type ProjectModel = z.infer<typeof ProjectModelSchema>

export function createEmptyModel(): ProjectModel {
  return {
    tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {}, tableGroups: {},
    domains: {}, words: {}, terms: {},
  }
}
