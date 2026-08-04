import type { Origin, ProjectModel } from './model.js'
import { ENTITY_KINDS, type EntityKind } from './op.js'

/**
 * 병합 대상 종류. note는 파일에 담기지 않으므로 타입 수준에서 제외한다 —
 * "메모를 병합 대상에 넣어 지워 버리는" 실수가 컴파일되지 않는다.
 */
export type MergeKind = Exclude<EntityKind, 'note'>

export const MERGE_KINDS: readonly MergeKind[] =
  ENTITY_KINDS.filter((k): k is MergeKind => k !== 'note')

/**
 * 모델 필드 → 파일(YAML) 키. 이 표 하나가 셋을 한다:
 *   1) 3-way 병합이 비교할 필드 목록
 *   2) 충돌 출력에 보여줄 필드 이름(사용자가 파일에서 실제로 보는 이름)
 *   3) FILE_INVISIBLE_FIELDS와 짝을 이뤄 "새 엔티티 필드를 분류하지 않으면 테스트가 깨지는" 게이트
 * 괄호 표기는 파일에 전용 키가 없고 배열 위치·파일 소속으로 표현되는 것들이다.
 */
export const FILE_FIELDS: Record<MergeKind, Record<string, string>> = {
  tableGroup: { name: 'name', color: 'color', comment: 'comment' },
  domain: {
    name: 'name', category: 'category', logicalType: 'logicalType',
    dialectTypes: 'dialectTypes', defaultValue: 'defaultValue',
    allowedValues: 'allowedValues', description: 'description',
  },
  word: {
    logicalName: 'logicalName', abbreviation: 'abbreviation',
    englishName: 'englishName', description: 'description',
  },
  term: {
    logicalName: 'logicalName', physicalName: 'physicalName',
    domainId: 'domain', description: 'description',
  },
  customField: {
    name: 'name', target: 'target', type: 'type', options: 'options',
    required: 'required', defaultValue: 'defaultValue', order: 'order',
  },
  table: {
    physicalName: 'name', logicalName: 'logicalName', comment: 'comment',
    groupId: 'group', custom: 'custom',
  },
  column: {
    tableId: '(소속 테이블)', physicalName: 'name', logicalName: 'logicalName',
    type: 'type', domainId: 'domain', isPk: 'pk', autoIncrement: 'autoIncrement',
    nullable: 'nullable', defaultValue: 'default', comment: 'comment',
    custom: 'custom', order: '(순서)',
  },
  relationship: {
    parentTableId: 'to', childTableId: '(소속 테이블)', columnMappings: 'columns',
    cardinality: 'cardinality', identifying: 'identifying', name: 'name',
  },
  index: { tableId: '(소속 테이블)', name: 'name', columns: 'columns', unique: 'unique' },
}

/** 파일에 담기지 않는 필드. 병합 대상이 아니고 push가 절대 건드리지 않는다. */
export const FILE_INVISIBLE_FIELDS: Record<MergeKind, readonly string[]> = {
  tableGroup: [],
  domain: ['origin'], word: ['origin'], term: ['origin'], customField: ['origin'],
  table: ['position', 'groupPosition'],
  column: [], relationship: [], index: [],
}

function clearOrigin<T extends { origin: Origin | null }>(
  collection: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(collection).map(([id, v]) => [id, { ...v, origin: null }]),
  ) as Record<string, T>
}

/**
 * 서버 모델을 filesToModel이 만드는 값으로 정규화한다.
 * base·local·server 셋을 같은 공간에 놓아야 3-way 비교가 성립한다.
 * 모든 컬렉션을 새 객체로 만든다 — 병합이 결과에서 delete를 하므로 서버 모델과
 * 컬렉션을 공유하면 서버 모델이 오염된다.
 */
export function fileVisibleModel(model: ProjectModel): ProjectModel {
  return {
    tables: Object.fromEntries(
      Object.entries(model.tables).map(([id, t]) => [
        id, { ...t, position: { x: 0, y: 0 }, groupPosition: null },
      ]),
    ) as ProjectModel['tables'],
    columns: { ...model.columns },
    relationships: { ...model.relationships },
    indexes: { ...model.indexes },
    notes: {},
    tableGroups: { ...model.tableGroups },
    domains: clearOrigin(model.domains),
    words: clearOrigin(model.words),
    terms: clearOrigin(model.terms),
    customFields: clearOrigin(model.customFields),
  }
}
