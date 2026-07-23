import type { ProjectModel } from './model.js'

// integrity.ts는 op.ts로부터 import되므로(applyOps가 무결성 검사를 호출) 순환 import를
// 막기 위해 EntityKind를 다시 import하지 않고 유니언을 이 파일에 리터럴로 정의한다.
export type IntegrityIssue = {
  entity: 'tableGroup' | 'table' | 'column' | 'relationship' | 'index' | 'note'
  entityId: string
  message: string
}

/** 참조 무결성 검사. 이슈가 없으면 빈 배열. */
export function validateModelIntegrity(model: ProjectModel): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []

  const collections: { entity: IntegrityIssue['entity']; record: Record<string, { id: string }> }[] = [
    { entity: 'tableGroup', record: model.tableGroups },
    { entity: 'table', record: model.tables },
    { entity: 'column', record: model.columns },
    { entity: 'relationship', record: model.relationships },
    { entity: 'index', record: model.indexes },
    { entity: 'note', record: model.notes },
  ]
  for (const { entity, record } of collections) {
    for (const [key, value] of Object.entries(record)) {
      if (key !== value.id) {
        issues.push({
          entity, entityId: key,
          message: `레코드 키(${key})와 id(${value.id}) 불일치`,
        })
      }
    }
  }

  for (const table of Object.values(model.tables)) {
    if (table.groupId !== null && !Object.hasOwn(model.tableGroups, table.groupId)) {
      issues.push({
        entity: 'table', entityId: table.id,
        message: `존재하지 않는 그룹 참조: ${table.groupId}`,
      })
    }
  }

  for (const column of Object.values(model.columns)) {
    if (!Object.hasOwn(model.tables, column.tableId)) {
      issues.push({
        entity: 'column', entityId: column.id,
        message: `존재하지 않는 테이블 참조: ${column.tableId}`,
      })
    }
  }

  for (const rel of Object.values(model.relationships)) {
    if (!Object.hasOwn(model.tables, rel.parentTableId) || !Object.hasOwn(model.tables, rel.childTableId)) {
      issues.push({
        entity: 'relationship', entityId: rel.id,
        message: '존재하지 않는 테이블 참조',
      })
      continue
    }
    for (const m of rel.columnMappings) {
      const child = Object.hasOwn(model.columns, m.childColumnId) ? model.columns[m.childColumnId] : undefined
      const parent = Object.hasOwn(model.columns, m.parentColumnId) ? model.columns[m.parentColumnId] : undefined
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
    if (!Object.hasOwn(model.tables, index.tableId)) {
      issues.push({
        entity: 'index', entityId: index.id,
        message: `존재하지 않는 테이블 참조: ${index.tableId}`,
      })
      continue
    }
    for (const ic of index.columns) {
      const column = Object.hasOwn(model.columns, ic.columnId) ? model.columns[ic.columnId] : undefined
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
