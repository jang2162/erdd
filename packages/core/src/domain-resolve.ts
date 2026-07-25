import type { Column, ProjectModel } from './model.js'
import { resolveColumnType, type Dialect } from './dialect.js'

export type ResolvedColumn = {
  sql: string
  logicalType: string
  warning?: string
  checkValues?: string[]
  defaultValue: string | null
}

export function resolveColumn(column: Column, model: ProjectModel, dialect: Dialect): ResolvedColumn {
  if (column.domainId) {
    const d = model.domains[column.domainId]
    if (d) {
      const override = d.dialectTypes[dialect]
      let sql: string
      let warning: string | undefined
      if (override && override.trim() !== '') {
        sql = override
      } else {
        const r = resolveColumnType(d.logicalType, dialect)
        sql = r.sql
        warning = r.warning
      }
      const defaultValue = column.defaultValue !== null && column.defaultValue !== ''
        ? column.defaultValue : d.defaultValue
      return {
        sql, logicalType: d.logicalType, warning,
        checkValues: d.allowedValues.length ? d.allowedValues : undefined, defaultValue,
      }
    }
  }
  const r = resolveColumnType(column.type, dialect)
  return { sql: r.sql, logicalType: column.type, warning: r.warning, defaultValue: column.defaultValue }
}
