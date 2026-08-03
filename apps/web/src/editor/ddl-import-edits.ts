import type {
  Column, DdlImportPlan, IndexDef, ProjectModel, Relationship, Table,
} from '@erdd/core'
import { computeAutoLayout } from './auto-layout.js'

const NODE_WIDTH = 260
const rowHeight = (columnCount: number) => 40 + columnCount * 28

/**
 * DDL 가져오기 계획(`DdlImportPlan`)을 모델에 적용해 새 `ProjectModel`을 만든다.
 *
 * `applyDictImport`와 같은 관례를 따른다 — 입력 모델은 손대지 않고 새 객체를 반환하며,
 * id 발급은 호출 측이 준 `newId()`에 위임한다.
 *
 * 좌표는 렌더 전이라 실측 크기가 없으므로 컬럼 수 기반 추정 높이로 `computeAutoLayout`을
 * 돌려 정하고, 기존 테이블이 있으면 그 아래(y max + 200)로 밀어 겹치지 않게 한다.
 *
 * `DdlImportTable`에는 테이블 comment 필드가 없다(계획 단계에서 이미 버려진 정보) —
 * 그래서 새로 만든 테이블의 `comment`는 항상 `null`이다. 컬럼은 `DdlImportColumn.comment`가
 * 있어 그대로 옮긴다.
 *
 * 인덱스 컬럼의 정렬 방향도 계획에 없는 정보다(파서가 ASC/DESC를 버림) — 항상 `'asc'`로 둔다.
 *
 * 관계의 `cardinality`·`name`도 `DdlImportRelationship`에 없는 필드다 — DDL의 FK는 카디널리티를
 * 명시하지 않으므로(1:1 UNIQUE 여부까지 추적하지 않음) 기존 관례(`createRelationshipFromParentPk`의
 * 기본값)를 따라 `cardinality: '1:N'`, `name: null`로 둔다.
 */
export function applyDdlImport(
  model: ProjectModel, plan: DdlImportPlan, newId: () => string,
): ProjectModel {
  const tables = { ...model.tables }
  const columns = { ...model.columns }
  const indexes = { ...model.indexes }
  const relationships = { ...model.relationships }

  // 자동 배치 — 렌더 전이라 실측 크기가 없으므로 컬럼 수 기반 높이 추정을 쓴다.
  const layoutNodes = plan.tables.map((t) => ({
    id: t.physicalName, width: NODE_WIDTH, height: rowHeight(t.columns.length),
  }))
  const layoutEdges = plan.relationships.map((r) => ({
    source: r.parentPhysicalName, target: r.childPhysicalName,
  }))
  const layout = computeAutoLayout(layoutNodes, layoutEdges)

  // 기존 테이블과 겹치지 않게 아래로 민다.
  const existingMaxY = Object.values(model.tables)
    .reduce((max, t) => Math.max(max, t.position.y), Number.NEGATIVE_INFINITY)
  const offsetY = Number.isFinite(existingMaxY) ? existingMaxY + 200 : 0

  const tableIdByName = new Map<string, string>()
  const columnIdByKey = new Map<string, string>() // `${테이블물리명}.${컬럼물리명}` -> id

  for (const t of plan.tables) {
    const id = newId()
    tableIdByName.set(t.physicalName, id)
    const pos = layout.get(t.physicalName)
    const table: Table = {
      id, logicalName: t.logicalName, physicalName: t.physicalName, comment: null,
      groupId: null,
      position: pos ? { x: pos.x, y: pos.y + offsetY } : { x: 0, y: offsetY },
      groupPosition: null, custom: {},
    }
    tables[id] = table
  }

  for (const t of plan.tables) {
    const tableId = tableIdByName.get(t.physicalName)!
    t.columns.forEach((c, order) => {
      const id = newId()
      columnIdByKey.set(`${t.physicalName}.${c.physicalName}`, id)
      const column: Column = {
        id, tableId, logicalName: c.logicalName, physicalName: c.physicalName,
        type: c.type, isPk: c.isPk, autoIncrement: c.autoIncrement, nullable: c.nullable,
        defaultValue: c.defaultValue, order, comment: c.comment, domainId: null, custom: {},
      }
      columns[id] = column
    })
  }

  for (const t of plan.tables) {
    const tableId = tableIdByName.get(t.physicalName)!
    for (const ix of t.indexes) {
      const id = newId()
      const index: IndexDef = {
        id, tableId, name: ix.name, unique: ix.unique,
        columns: ix.columnPhysicalNames.map((colName) => ({
          columnId: columnIdByKey.get(`${t.physicalName}.${colName}`)!,
          direction: 'asc',
        })),
      }
      indexes[id] = index
    }
  }

  for (const r of plan.relationships) {
    const id = newId()
    const parentTableId = tableIdByName.get(r.parentPhysicalName)!
    const childTableId = tableIdByName.get(r.childPhysicalName)!
    const relationship: Relationship = {
      id, parentTableId, childTableId,
      columnMappings: r.columnPairs.map((p) => ({
        childColumnId: columnIdByKey.get(`${r.childPhysicalName}.${p.child}`)!,
        parentColumnId: columnIdByKey.get(`${r.parentPhysicalName}.${p.parent}`)!,
      })),
      cardinality: '1:N',
      identifying: r.identifying,
      name: null,
    }
    relationships[id] = relationship
  }

  return { ...model, tables, columns, indexes, relationships }
}
