import { deleteTableCascade, type Position, type ProjectModel, type Table } from '@erdd/core'

/** 사용 중이지 않은 가장 작은 TABLE_n. 논리명이 정해지기 전의 임시 물리명이다. */
export function nextTablePhysicalName(model: ProjectModel): string {
  const used = new Set(Object.values(model.tables).map((t) => t.physicalName))
  let n = 1
  while (used.has(`TABLE_${n}`)) n++
  return `TABLE_${n}`
}

/** 새 테이블의 임시 논리명 번호. 「테이블1」이 이미 있으면 2를 쓴다. */
function nextTableLogicalName(model: ProjectModel): string {
  const used = new Set(Object.values(model.tables).map((t) => t.logicalName))
  let n = 1
  while (used.has(`테이블${n}`)) n++
  return `테이블${n}`
}

/**
 * 새 테이블(컬럼 없음). 물리명은 **비워 둔다** — 논리명을 입력하면 편집 패널이 사전으로 생성한다.
 * 물리명이 빈 테이블은 DDL에서 제외되고(core ddl.ts) required-empty 경고가 붙는다.
 */
export function addTable(
  model: ProjectModel, { id, position }: { id: string; position: Position },
): ProjectModel {
  const table: Table = {
    id, logicalName: nextTableLogicalName(model), physicalName: '',
    comment: null, groupId: null, position, groupPosition: null, custom: {},
  }
  return { ...model, tables: { ...model.tables, [id]: table } }
}

export function moveTable(model: ProjectModel, id: string, position: Position): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, position } } }
}

export function moveTableGroupPosition(model: ProjectModel, id: string, position: Position): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, groupPosition: position } } }
}

/**
 * 그룹이 바뀌면 이전 그룹 뷰 좌표는 의미가 없다 — 전체 뷰 좌표로 폴백하도록 비운다.
 *
 * `updateTable`의 patch 타입은 텍스트 3필드(`logicalName`·`physicalName`·`comment`)로 좁혀져 있어
 * `groupPosition`을 받지 못한다. 그 좁은 계약을 넓히는 대신 `moveTableGroupPosition`과 대칭인
 * 전용 함수를 둔다.
 */
export function clearTableGroupPosition(model: ProjectModel, id: string): ProjectModel {
  const table = model.tables[id]
  if (!table || table.groupPosition === null) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, groupPosition: null } } }
}

export function updateTable(
  model: ProjectModel, id: string,
  patch: Partial<Pick<Table, 'logicalName' | 'physicalName' | 'comment'>>,
): ProjectModel {
  const table = model.tables[id]
  if (!table) return model
  return { ...model, tables: { ...model.tables, [id]: { ...table, ...patch } } }
}

/** 테이블과 그 소속 컬럼·인덱스·관계를 제거한다. */
export function removeTable(model: ProjectModel, id: string): ProjectModel {
  return deleteTableCascade(model, id)
}
