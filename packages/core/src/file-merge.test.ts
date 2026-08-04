import { describe, expect, it } from 'vitest'
import {
  TableSchema, ColumnSchema, RelationshipSchema, IndexSchema, TableGroupSchema,
  DomainSchema, WordSchema, TermSchema, CustomFieldSchema,
} from './model.js'
import {
  FILE_FIELDS, FILE_INVISIBLE_FIELDS, MERGE_KINDS, fileVisibleModel, type MergeKind,
} from './file-merge.js'
import { fullModel } from './testing/fixtures.js'

/** zod 스키마에서 실제 키를 뽑는다 — 손으로 적은 목록은 드리프트한다. */
const SHAPE_BY_KIND: Record<MergeKind, { shape: object }> = {
  tableGroup: TableGroupSchema, domain: DomainSchema, word: WordSchema,
  term: TermSchema, customField: CustomFieldSchema, table: TableSchema,
  column: ColumnSchema, relationship: RelationshipSchema, index: IndexSchema,
}

describe('FILE_FIELDS 완전성', () => {
  it('note를 제외한 9종을 담는다', () => {
    expect([...MERGE_KINDS].sort()).toEqual(Object.keys(SHAPE_BY_KIND).sort())
    expect(MERGE_KINDS as readonly string[]).not.toContain('note')
  })

  it.each(MERGE_KINDS)('%s의 모든 필드가 가시/비가시 중 정확히 한쪽에 있다', (kind) => {
    const actual = Object.keys(SHAPE_BY_KIND[kind].shape).filter((k) => k !== 'id')
    const visible = Object.keys(FILE_FIELDS[kind])
    const invisible = [...FILE_INVISIBLE_FIELDS[kind]]
    // 한쪽에만 있으면 합집합의 길이가 actual과 같다. 양쪽에 있으면 중복이 생겨 길이가 어긋난다.
    expect([...visible, ...invisible].sort()).toEqual([...actual].sort())
    expect(visible.filter((v) => invisible.includes(v))).toEqual([])
  })
})

describe('fileVisibleModel', () => {
  it('메모·좌표·origin을 파일 공간 값으로 정규화한다', () => {
    const m = fullModel()
    m.domains['d1']!.origin = { libraryId: 'L1', sourceId: 'S1', sourceVersion: 3, base: {} }
    const v = fileVisibleModel(m)
    expect(v.notes).toEqual({})
    expect(v.tables['tb1']!.position).toEqual({ x: 0, y: 0 })
    expect(v.tables['tb1']!.groupPosition).toBeNull()
    expect(v.domains['d1']!.origin).toBeNull()
  })

  it('원본을 변형하지 않고 컬렉션도 새 객체로 만든다', () => {
    const m = fullModel()
    const v = fileVisibleModel(m)
    expect(m.notes['n1']).toBeDefined()
    expect(m.tables['tb1']!.position).toEqual({ x: 10, y: 20 })
    // 병합이 결과 컬렉션에서 delete를 하므로 원본과 같은 객체를 공유하면 서버 모델이 오염된다.
    expect(v.tables).not.toBe(m.tables)
    expect(v.columns).not.toBe(m.columns)
    expect(v.tableGroups).not.toBe(m.tableGroups)
  })
})
