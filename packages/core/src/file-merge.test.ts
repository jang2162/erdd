import { describe, expect, it } from 'vitest'
import {
  TableSchema, ColumnSchema, RelationshipSchema, IndexSchema, TableGroupSchema,
  DomainSchema, WordSchema, TermSchema, CustomFieldSchema,
} from './model.js'
import {
  FILE_FIELDS, FILE_INVISIBLE_FIELDS, MERGE_KINDS, fileVisibleModel, mergeModels, type MergeKind,
} from './file-merge.js'
import type { ProjectModel } from './model.js'
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

const clone = (m: ProjectModel): ProjectModel => JSON.parse(JSON.stringify(m)) as ProjectModel

/** 같은 뿌리에서 갈라진 base·local·server 셋. 전부 파일 가시 공간이다. */
function trio(): { base: ProjectModel; local: ProjectModel; server: ProjectModel } {
  const base = fileVisibleModel(fullModel())
  return { base, local: clone(base), server: clone(base) }
}

describe('mergeModels — 상태표', () => {
  it('서버만 추가한 것은 그대로 유지한다', () => {
    const { base, local, server } = trio()
    server.tableGroups['g2'] = { id: 'g2', name: '주문관리', color: '#fee', comment: null }
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.tableGroups['g2']).toBeDefined()
  })

  it('양쪽이 지웠으면 아무 일도 없다', () => {
    const { base, local, server } = trio()
    delete local.indexes['ix2']
    delete server.indexes['ix2']
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.indexes['ix2']).toBeUndefined()
  })

  it('로컬만 지웠고 서버가 안 건드렸으면 삭제한다', () => {
    const { base, local, server } = trio()
    delete local.indexes['ix2']
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.indexes['ix2']).toBeUndefined()
  })

  it('로컬이 지운 것을 서버가 고쳤으면 충돌이다', () => {
    const { base, local, server } = trio()
    delete local.indexes['ix2']
    server.indexes['ix2']!.name = 'IX_ORD_99'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'index', entityId: 'ix2', field: '*', reason: 'local-delete',
      local: null, changedFields: ['name'],
    })
  })

  it('로컬만 추가한 것은 생성한다', () => {
    const { base, local, server } = trio()
    local.tableGroups['g9'] = { id: 'g9', name: '정산', color: '#efe', comment: null }
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.tableGroups['g9']!.name).toBe('정산')
  })

  it('양쪽이 같은 id로 다르게 추가하면 필드마다 충돌이다', () => {
    const { base, local, server } = trio()
    local.tableGroups['g9'] = { id: 'g9', name: '정산', color: '#efe', comment: null }
    server.tableGroups['g9'] = { id: 'g9', name: '결제', color: '#efe', comment: null }
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'tableGroup', entityId: 'g9', field: 'name', reason: 'both-added',
      base: null, local: '정산', server: '결제',
    })
  })

  it('서버가 지운 것을 로컬이 안 건드렸으면 삭제를 수용한다', () => {
    const { base, local, server } = trio()
    delete server.indexes['ix2']
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.indexes['ix2']).toBeUndefined()
  })

  it('서버가 지운 것을 로컬이 고쳤으면 충돌이다', () => {
    const { base, local, server } = trio()
    delete server.indexes['ix2']
    local.indexes['ix2']!.name = 'IX_ORD_99'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'index', entityId: 'ix2', field: '*', reason: 'server-delete',
      server: null, changedFields: ['name'],
    })
  })
})

describe('mergeModels — 필드 단위', () => {
  it('서로 다른 필드를 고치면 자동 병합한다', () => {
    const { base, local, server } = trio()
    local.columns['c2']!.logicalName = '회원 이름'
    server.columns['c2']!.comment = '이름 컬럼'
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.columns['c2']!.logicalName).toBe('회원 이름')
    expect(merged.columns['c2']!.comment).toBe('이름 컬럼')
  })

  it('같은 필드를 다르게 고치면 충돌이다', () => {
    const { base, local, server } = trio()
    local.columns['c2']!.logicalName = '회원 이름'
    server.columns['c2']!.logicalName = '회원성명'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toEqual({
      path: 'erdd/tables/MBR.yaml',
      kind: 'column', entityId: 'c2', label: '컬럼 MBR.MBR_NM',
      field: 'logicalName', reason: 'field',
      base: '회원명', local: '회원 이름', server: '회원성명',
      changedFields: [],
    })
  })

  it('같은 필드를 같은 값으로 고치면 충돌이 아니다', () => {
    const { base, local, server } = trio()
    local.columns['c2']!.logicalName = '회원 이름'
    server.columns['c2']!.logicalName = '회원 이름'
    const { merged, conflicts } = mergeModels(base, local, server)
    expect(conflicts).toEqual([])
    expect(merged.columns['c2']!.logicalName).toBe('회원 이름')
  })

  it('참조형 필드는 각자의 모델 기준으로 이름을 풀고 YAML 키 이름으로 보고한다', () => {
    const { base, local, server } = trio()
    // d1을 서버에서만 개명한다 — local·server 둘 다 같은 id('d1')를 서버 모델로만 풀면
    // (버그: "항상 서버 모델로 해석") local 값이 우연히 base와 같아지는 일이 없도록
    // local의 d1과 서버의 d1이 서로 다른 이름을 갖게 만든다.
    server.domains['d1']!.name = '식별명'
    server.domains['d2'] = { ...server.domains['d1']!, id: 'd2', name: '식별번호' }
    local.columns['c1']!.domainId = 'd1'
    server.columns['c1']!.domainId = 'd2'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      field: 'domain', reason: 'field',
      base: null, local: '명', server: '식별번호',
    })
  })

  it('최상위 파일 엔티티의 path는 그 파일이다', () => {
    const { base, local, server } = trio()
    local.words['w1']!.abbreviation = 'MEM'
    server.words['w1']!.abbreviation = 'MB'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts[0]).toMatchObject({
      path: 'erdd/words.yaml', label: '단어 회원', field: 'abbreviation',
    })
  })

  it.each([
    ['tableGroup', 'groups.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.tableGroups['g1']!.name = '회원관리부'
      m.server.tableGroups['g1']!.name = '회원부'
    }] as const,
    ['domain', 'domains.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.domains['d1']!.name = '명칭'
      m.server.domains['d1']!.name = '식별명'
    }] as const,
    ['term', 'terms.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.terms['t1']!.physicalName = 'MBR_NO_L'
      m.server.terms['t1']!.physicalName = 'MBR_NO_S'
    }] as const,
    ['customField', 'custom-fields.yaml', (m: { local: ProjectModel; server: ProjectModel }) => {
      m.local.customFields['cf1']!.name = '개인정보여부_L'
      m.server.customFields['cf1']!.name = '개인정보여부_S'
    }] as const,
  ])('최상위 파일 엔티티(%s)의 path는 %s다', (kind, file, mutate) => {
    const { base, local, server } = trio()
    mutate({ local, server })
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind, path: `erdd/${file}` })
  })

  it('관계 충돌의 path는 부모가 아니라 자식 테이블 파일이다', () => {
    const { base, local, server } = trio()
    // r1은 부모 tb1(MBR) → 자식 tb2(ORD). 관계는 자식 테이블 파일에만 적히므로
    // path는 ORD.yaml이어야 한다 — parentTableId로 잘못 짚으면 MBR.yaml이 나온다.
    local.relationships['r1']!.name = 'FK_LOCAL'
    server.relationships['r1']!.name = 'FK_SERVER'
    const { conflicts } = mergeModels(base, local, server)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'relationship', entityId: 'r1', field: 'name', reason: 'field',
      path: 'erdd/tables/ORD.yaml',
    })
  })
})
