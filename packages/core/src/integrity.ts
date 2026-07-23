import type { ProjectModel } from './model.js'

export type IntegrityIssue = {
  entity: 'table' | 'column' | 'relationship' | 'index'
  entityId: string
  message: string
}

/** 참조 무결성 검사. 이슈가 없으면 빈 배열. */
export function validateModelIntegrity(model: ProjectModel): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []

  for (const table of Object.values(model.tables)) {
    if (table.groupId !== null && !model.tableGroups[table.groupId]) {
      issues.push({
        entity: 'table', entityId: table.id,
        message: `존재하지 않는 그룹 참조: ${table.groupId}`,
      })
    }
  }

  for (const column of Object.values(model.columns)) {
    if (!model.tables[column.tableId]) {
      issues.push({
        entity: 'column', entityId: column.id,
        message: `존재하지 않는 테이블 참조: ${column.tableId}`,
      })
    }
  }

  for (const rel of Object.values(model.relationships)) {
    if (!model.tables[rel.parentTableId] || !model.tables[rel.childTableId]) {
      issues.push({
        entity: 'relationship', entityId: rel.id,
        message: '존재하지 않는 테이블 참조',
      })
      continue
    }
    for (const m of rel.columnMappings) {
      const child = model.columns[m.childColumnId]
      const parent = model.columns[m.parentColumnId]
      if (!child || child.tableId !== rel.childTableId || !parent || parent.tableId !== rel.parentTableId) {
        issues.push({
          entity: 'relationship', entityId: rel.id,
          message: '매핑 컬럼이 없거나 소속 테이블이 다름',
        })
        break
      }
    }
  }

  for (const index of Object.values(model.indexes)) {
    if (!model.tables[index.tableId]) {
      issues.push({
        entity: 'index', entityId: index.id,
        message: `존재하지 않는 테이블 참조: ${index.tableId}`,
      })
      continue
    }
    for (const ic of index.columns) {
      const column = model.columns[ic.columnId]
      if (!column || column.tableId !== index.tableId) {
        issues.push({
          entity: 'index', entityId: index.id,
          message: '인덱스 컬럼이 없거나 소속 테이블이 다름',
        })
        break
      }
    }
  }

  return issues
}
