import type { Column, Position, ProjectModel, Relationship, Table } from './model.js'

function childColumns(model: ProjectModel, tableId: string): Column[] {
  return Object.values(model.columns).filter((c) => c.tableId === tableId)
}

/** base 물리명이 used에 있으면 _2, _3… 붙여 사용 중이지 않은 이름을 만든다. */
function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

/** 부모 PK 컬럼을 order 순으로 반환. */
function parentPkColumns(model: ProjectModel, parentTableId: string): Column[] {
  return childColumns(model, parentTableId)
    .filter((c) => c.isPk)
    .sort((a, b) => a.order - b.order)
}

export function createRelationshipFromParentPk(
  model: ProjectModel,
  args: {
    relationshipId: string
    parentTableId: string
    childTableId: string
    newColumnIds: string[]
    cardinality?: '1:1' | '1:N'
    identifying?: boolean
    name?: string | null
  },
): ProjectModel {
  const { relationshipId, parentTableId, childTableId, newColumnIds } = args
  if (!model.tables[parentTableId] || !model.tables[childTableId]) return model
  const pks = parentPkColumns(model, parentTableId)
  if (pks.length === 0) return model // 부모 PK 없음 — no-op(호출 측이 경고)
  if (newColumnIds.length < pks.length) {
    throw new Error('FK 컬럼 id가 부족합니다')
  }

  const identifying = args.identifying ?? false
  const existing = childColumns(model, childTableId)
  const usedPhysical = new Set(existing.map((c) => c.physicalName))
  const usedLogical = new Set(existing.map((c) => c.logicalName))
  let order = existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.order)) + 1

  const newColumns: Record<string, Column> = {}
  const mappings: Relationship['columnMappings'] = []

  pks.forEach((pk, i) => {
    const id = newColumnIds[i]!
    const physicalName = uniqueName(pk.physicalName, usedPhysical)
    const logicalName = uniqueName(pk.logicalName, usedLogical)
    usedPhysical.add(physicalName)
    usedLogical.add(logicalName)
    newColumns[id] = {
      id, tableId: childTableId, logicalName, physicalName, type: pk.type,
      isPk: identifying, autoIncrement: false, nullable: false,
      defaultValue: null, order: order++, comment: null, domainId: null, custom: {},
    }
    mappings.push({ childColumnId: id, parentColumnId: pk.id })
  })

  const relationship: Relationship = {
    id: relationshipId, parentTableId, childTableId, columnMappings: mappings,
    cardinality: args.cardinality ?? '1:N', identifying, name: args.name ?? null,
  }

  return {
    ...model,
    columns: { ...model.columns, ...newColumns },
    relationships: { ...model.relationships, [relationshipId]: relationship },
  }
}

export function remapRelationshipChildColumn(
  model: ProjectModel,
  args: { relationshipId: string; parentColumnId: string; newChildColumnId: string },
): ProjectModel {
  const rel = model.relationships[args.relationshipId]
  if (!rel) return model
  const target = rel.columnMappings.find((m) => m.parentColumnId === args.parentColumnId)
  if (!target) return model
  const newChild = model.columns[args.newChildColumnId]
  if (!newChild || newChild.tableId !== rel.childTableId) return model
  const oldChildId = target.childColumnId
  if (oldChildId === args.newChildColumnId) return model

  const columnMappings = rel.columnMappings.map((m) =>
    m.parentColumnId === args.parentColumnId
      ? { childColumnId: args.newChildColumnId, parentColumnId: m.parentColumnId }
      : m,
  )
  const relationships = { ...model.relationships, [rel.id]: { ...rel, columnMappings } }

  // 새로 매핑된 컬럼의 isPk를 관계의 식별 상태에 맞춘다(setRelationshipIdentifying과 동일 규칙).
  const columns = { ...model.columns, [args.newChildColumnId]: { ...newChild, isPk: rel.identifying } }

  // 이전 자식 컬럼이 어떤 관계 매핑·인덱스에서도 더 쓰이지 않을 때만 삭제(자동생성 FK 정리).
  const referencedElsewhere = Object.values(relationships).some((r) =>
    r.columnMappings.some((m) => m.childColumnId === oldChildId || m.parentColumnId === oldChildId))
  const inIndex = Object.values(model.indexes).some((ix) =>
    ix.columns.some((ic) => ic.columnId === oldChildId))
  if (!referencedElsewhere && !inIndex) delete columns[oldChildId]

  return { ...model, columns, relationships }
}

export function setRelationshipIdentifying(
  model: ProjectModel, relationshipId: string, identifying: boolean,
): ProjectModel {
  const rel = model.relationships[relationshipId]
  if (!rel) return model
  const columns = { ...model.columns }
  for (const m of rel.columnMappings) {
    const c = columns[m.childColumnId]
    if (c) columns[m.childColumnId] = { ...c, isPk: identifying }
  }
  return {
    ...model,
    columns,
    relationships: { ...model.relationships, [rel.id]: { ...rel, identifying } },
  }
}

export function deleteRelationship(model: ProjectModel, relationshipId: string): ProjectModel {
  if (!model.relationships[relationshipId]) return model
  const relationships = { ...model.relationships }
  delete relationships[relationshipId] // 자식 FK 컬럼은 보존
  return { ...model, relationships }
}

export function deleteTableCascade(model: ProjectModel, tableId: string): ProjectModel {
  if (!model.tables[tableId]) return model
  const tables = { ...model.tables }
  delete tables[tableId]
  const columns = Object.fromEntries(
    Object.entries(model.columns).filter(([, c]) => c.tableId !== tableId),
  )
  const indexes = Object.fromEntries(
    Object.entries(model.indexes).filter(([, ix]) => ix.tableId !== tableId),
  )
  // 이 테이블이 부모 또는 자식인 관계 삭제(반대편 FK 컬럼은 위 columns 필터로 보존됨).
  const relationships = Object.fromEntries(
    Object.entries(model.relationships).filter(
      ([, r]) => r.parentTableId !== tableId && r.childTableId !== tableId,
    ),
  )
  return { ...model, tables, columns, indexes, relationships }
}

export function deleteColumnCascade(model: ProjectModel, columnId: string): ProjectModel {
  if (!model.columns[columnId]) return model
  const columns = { ...model.columns }
  delete columns[columnId]

  const relationships: Record<string, Relationship> = {}
  for (const rel of Object.values(model.relationships)) {
    const columnMappings = rel.columnMappings.filter(
      (m) => m.childColumnId !== columnId && m.parentColumnId !== columnId,
    )
    if (columnMappings.length === 0) continue // 매핑이 비면 관계 삭제
    relationships[rel.id] =
      columnMappings.length === rel.columnMappings.length ? rel : { ...rel, columnMappings }
  }

  // 삭제된 컬럼을 참조하던 인덱스 컬럼도 정리(무결성 유지).
  const indexes: ProjectModel['indexes'] = {}
  for (const ix of Object.values(model.indexes)) {
    const cols = ix.columns.filter((ic) => ic.columnId !== columnId)
    if (cols.length === ix.columns.length) indexes[ix.id] = ix
    else if (cols.length > 0) indexes[ix.id] = { ...ix, columns: cols }
    // cols.length === 0 이면 인덱스 삭제
  }

  return { ...model, columns, relationships, indexes }
}

/** 교차 테이블의 기본 논리명 — 두 부모 논리명을 구분자 없이 잇는다(설계 D4). */
export function junctionTableName(parent: Table, child: Table): string {
  return `${parent.logicalName}${child.logicalName}`
}

export type JunctionSpec = {
  id: string
  logicalName: string
  physicalName: string
  position: Position
  groupId: string | null
  groupPosition: Position | null
}

/**
 * 1:N 관계를 교차 테이블 + 식별 1:N 관계 2개로 바꾼다(설계 3절).
 * id·이름·좌표는 호출측이 계산해 넘긴다 — core는 id를 만들지 않는다.
 * 아래 어느 가드에 걸려도 model을 그대로 돌려준다(부분 상태를 남기지 않는다).
 */
export function resolveManyToMany(
  model: ProjectModel,
  args: {
    relationshipId: string
    junction: JunctionSpec
    a: { relationshipId: string; newColumnIds: string[] }
    b: { relationshipId: string; newColumnIds: string[] }
  },
): ProjectModel {
  const rel = model.relationships[args.relationshipId]
  if (!rel) return model
  if (rel.identifying) return model // 자식 PK 구성이 바뀌어 하위 관계가 깨진다(설계 3.3)

  const parentTableId = rel.parentTableId
  const childTableId = rel.childTableId // 관계가 사라지기 전에 읽어 둔다
  // 무테스트 가드다 — validateModelIntegrity가 관계의 부모·자식 테이블 존재를 이미 검사하므로
  // 여기 걸리는 모델은 그 자체로 무결성 위반이고, 정상 경로로는 도달할 수 없다.
  // 그래도 남긴다: 동시편집으로 뒤늦게 도착한 mutation이 깨진 모델을 만들지 않게 하는 방어다.
  if (!model.tables[parentTableId] || !model.tables[childTableId]) return model

  // PK 개수는 "FK를 지운 뒤"를 기준으로 센다(설계 3.4).
  // 매핑은 같은 childColumnId를 두 번 담을 수 있으므로(remapRelationshipChildColumn이
  // 그렇게 만든다) 중복을 없애고 센다 — 중복을 세면 droppedPk가 실제 삭제량보다 커져
  // pkCount - droppedPk가 음수가 되고, 그 음수가 '=== 0' 비교를 빠져나간다.
  const fkColumnIds = [...new Set(rel.columnMappings.map((m) => m.childColumnId))]
  const droppedPk = fkColumnIds.filter((id) => model.columns[id]?.isPk).length
  const pkCount = (tableId: string) =>
    Object.values(model.columns).filter((c) => c.tableId === tableId && c.isPk).length
  if (pkCount(parentTableId) === 0) return model
  // <= 0 은 위 dedup이 깨져도 부분 상태를 막는 이중 방어다.
  if (pkCount(childTableId) - droppedPk <= 0) return model

  // FK 컬럼을 지우면 매핑이 비면서 원본 관계도 함께 사라진다(설계 3.2).
  // deleteRelationship은 자식 FK 컬럼을 일부러 보존하므로 쓰지 않는다.
  let next = model
  for (const id of fkColumnIds) next = deleteColumnCascade(next, id)

  const junction: Table = {
    id: args.junction.id,
    logicalName: args.junction.logicalName,
    physicalName: args.junction.physicalName,
    comment: null,
    groupId: args.junction.groupId,
    position: args.junction.position,
    groupPosition: args.junction.groupPosition,
    custom: {},
  }
  next = { ...next, tables: { ...next.tables, [junction.id]: junction } }

  next = createRelationshipFromParentPk(next, {
    relationshipId: args.a.relationshipId,
    parentTableId, childTableId: junction.id,
    newColumnIds: args.a.newColumnIds,
    cardinality: '1:N', identifying: true,
  })
  return createRelationshipFromParentPk(next, {
    relationshipId: args.b.relationshipId,
    parentTableId: childTableId, childTableId: junction.id,
    newColumnIds: args.b.newColumnIds,
    cardinality: '1:N', identifying: true,
  })
}
