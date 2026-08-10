import type {
  Column, DdlImportPlan, IndexDef, ProjectModel, Relationship, Table,
} from '@erdd/core'
import { computeAutoLayout } from './auto-layout.js'
import { nextGroupColor } from './group-palette.js'

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
 * 테이블의 `comment`는 `DdlImportTable.comment`를 그대로 옮긴다(계획 단계에서 `COMMENT ON
 * TABLE`의 설명 부분을 이미 분리해 담아 둔다). 컬럼은 `DdlImportColumn.comment`가
 * 있어 그대로 옮긴다.
 *
 * 인덱스 컬럼의 정렬 방향도 계획에 없는 정보다(파서가 ASC/DESC를 버림) — 항상 `'asc'`로 둔다.
 *
 * 관계의 `cardinality`·`name`은 계획이 정한다 — DDL 경로에서는 계획이 `'1:N'`·`null`을 주고,
 * DBML 경로에서는 `-` 연산자와 `Ref` 이름이 그대로 실려 온다.
 *
 * 그룹도 계획이 정한다(DBML의 `TableGroup`). `existingId`가 있으면 그 그룹에 넣고 **색·설명을
 * 덮어쓰지 않는다** — 가져오는 파일이 프로젝트의 기존 결정을 바꿔선 안 된다.
 * `groupPosition`은 `null`로 둔다 — 그룹 뷰 좌표는 그 뷰를 처음 열 때 계산된다.
 */
export function applyDdlImport(
  model: ProjectModel, plan: DdlImportPlan, newId: () => string,
): ProjectModel {
  const tables = { ...model.tables }
  const columns = { ...model.columns }
  const indexes = { ...model.indexes }
  const relationships = { ...model.relationships }
  const tableGroups = { ...model.tableGroups }

  // 그룹을 먼저 만든다(또는 기존 것을 쓴다) — 테이블 생성부가 groupId를 꽂아야 한다.
  const groupIdByTable = new Map<string, string>()
  const usedColors = Object.values(model.tableGroups).map((g) => g.color)
  for (const g of plan.groups) {
    let groupId = g.existingId
    if (groupId === null) {
      groupId = newId()
      const color = g.color ?? nextGroupColor(usedColors)
      usedColors.push(color)
      tableGroups[groupId] = { id: groupId, name: g.name, color, comment: g.comment }
    }
    for (const name of g.tablePhysicalNames) groupIdByTable.set(name, groupId)
  }

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
      id, logicalName: t.logicalName, physicalName: t.physicalName, comment: t.comment,
      groupId: groupIdByTable.get(t.physicalName) ?? null,
      position: pos ? { x: pos.x, y: pos.y + offsetY } : { x: 0, y: offsetY },
      groupPosition: null, custom: t.custom,
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
        defaultValue: c.defaultValue, order, comment: c.comment, domainId: null, custom: c.custom,
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
      cardinality: r.cardinality,
      identifying: r.identifying,
      name: r.name,
    }
    relationships[id] = relationship
  }

  return { ...model, tables, columns, indexes, relationships, tableGroups }
}
