import type { ProjectModel } from './model.js'

export type Warning = {
  kind: 'duplicate-physical' | 'type-mismatch' | 'incomplete-mapping'
  scope: 'column' | 'relationship'
  entityId: string
  tableId?: string
  message: string
}

export function computeWarnings(model: ProjectModel): Warning[] {
  const warnings: Warning[] = []

  // 1) 같은 테이블 물리명 중복
  const byTable = new Map<string, Map<string, string[]>>() // tableId → physicalName → columnIds
  for (const c of Object.values(model.columns)) {
    if (c.physicalName === '') continue
    let names = byTable.get(c.tableId)
    if (!names) { names = new Map(); byTable.set(c.tableId, names) }
    const ids = names.get(c.physicalName) ?? []
    ids.push(c.id)
    names.set(c.physicalName, ids)
  }
  for (const [tableId, names] of byTable) {
    for (const [physicalName, ids] of names) {
      if (ids.length < 2) continue
      for (const id of ids) {
        warnings.push({
          kind: 'duplicate-physical', scope: 'column', entityId: id, tableId,
          message: `물리명 "${physicalName}"이(가) 같은 테이블에서 중복됩니다`,
        })
      }
    }
  }

  // 2), 3) 관계 타입 불일치 / 매핑 불완전
  for (const rel of Object.values(model.relationships)) {
    const parentPkCount = Object.values(model.columns).filter(
      (c) => c.tableId === rel.parentTableId && c.isPk,
    ).length
    if (parentPkCount !== rel.columnMappings.length) {
      warnings.push({
        kind: 'incomplete-mapping', scope: 'relationship', entityId: rel.id,
        message: '부모 기본 키와 매핑 수가 일치하지 않습니다',
      })
    }
    for (const m of rel.columnMappings) {
      const child = model.columns[m.childColumnId]
      const parent = model.columns[m.parentColumnId]
      if (child && parent && child.type !== parent.type) {
        warnings.push({
          kind: 'type-mismatch', scope: 'relationship', entityId: rel.id,
          message: `참조 컬럼 타입이 다릅니다 (${parent.type} ↔ ${child.type})`,
        })
        break // 관계당 1건
      }
    }
  }

  return warnings
}
