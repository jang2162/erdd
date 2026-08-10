import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { DEFAULT_NAMING_RULES } from './naming.js'
import { generateDbml } from './dbml.js'
import { parseDbml } from './dbml-parse.js'
import { planDdlImport } from './ddl-import.js'

/**
 * 왕복 픽스처. PostgreSQL 로 돌린다 — 타입 매핑이 단사라 방언 충돌 5건
 * (2026-08-03-ddl-reverse-engineering-design.md §2)이 개입하지 않는다.
 * 도메인은 쓰지 않는다(설계 §7 — domainId 는 이 범위의 경계다).
 */
function roundTripModel(): ProjectModel {
  const m = createEmptyModel()
  m.customFields['f1'] = {
    id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
    required: false, defaultValue: null, order: 0, origin: null,
  }
  m.customFields['f2'] = {
    id: 'f2', name: '개인정보', target: 'column', type: 'text', options: [],
    required: false, defaultValue: null, order: 0, origin: null,
  }
  m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#0E7A6C', comment: null }
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: "it's 회원\n두 줄 설명",
    groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: null, custom: { f1: '2' },
  }
  m.tables['t2'] = {
    id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: null, custom: {},
  }
  m.tables['t3'] = {
    id: 't3', logicalName: '회원상세', physicalName: 'MBR_DTL', comment: null,
    groupId: null, position: { x: 600, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: "'익명'", order: 1, comment: '표시용 이름', domainId: null,
    custom: { f2: 'Y' },
  }
  // 복합 PK + 합성 FK
  m.columns['c3'] = {
    id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  m.columns['c5'] = {
    id: 'c5', tableId: 't3', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
    columns: [{ columnId: 'c2', direction: 'asc' }],
  }
  m.relationships['r1'] = {                       // 익명 1:N
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: true, name: null,
  }
  m.relationships['r2'] = {                       // 이름 있는 1:1
    id: 'r2', parentTableId: 't1', childTableId: 't3',
    columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c1' }],
    cardinality: '1:1', identifying: true, name: 'FK_MBR_DTL_MBR',
  }
  return m
}

describe('DBML 왕복 — 내보낸 것을 다시 읽으면 같은 계획이 나온다', () => {
  const model = roundTripModel()
  const dbml = generateDbml(model, 'postgresql', { kind: 'all' }, { projectName: '회원 시스템' })
  // 커스텀 항목 정의는 DBML 에 실리지 않으므로(설계 §1) 정의만 있는 빈 모델로 되읽는다.
  const target = createEmptyModel()
  target.customFields = model.customFields
  const plan = planDdlImport(target, parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)

  it('구조 경고가 없다', () => {
    expect(plan.warnings.filter(
      (w) => w.kind === 'unresolved-fk' || w.kind === 'unresolved-index'
          || w.kind === 'table-conflict' || w.kind === 'unknown-custom-field',
    )).toEqual([])
  })

  it('테이블·논리명·설명·커스텀이 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.logicalName).toBe('회원')
    expect(mbr.comment).toBe("it's 회원\n두 줄 설명")
    expect(mbr.custom).toEqual({ f1: '2' })
  })

  it('컬럼 타입·PK·기본값·커스텀이 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.columns[0]).toMatchObject({
      physicalName: 'MBR_NO', type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    })
    expect(mbr.columns[1]).toMatchObject({
      physicalName: 'MBR_NM', type: 'VARCHAR(100)', defaultValue: "'익명'",
      comment: '표시용 이름', custom: { f2: 'Y' },
    })
  })

  it('복합 PK 가 왕복한다', () => {
    const ord = plan.tables.find((t) => t.physicalName === 'ORD')!
    expect(ord.columns.filter((c) => c.isPk).map((c) => c.physicalName)).toEqual(['ORD_NO', 'MBR_NO'])
  })

  it('인덱스가 이름째 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.indexes).toEqual([{ name: 'IX_MBR_NM', columnPhysicalNames: ['MBR_NM'], unique: false }])
  })

  it('그룹이 색째 왕복한다', () => {
    expect(plan.groups).toEqual([{
      name: '회원 관리', color: '#0E7A6C',
      tablePhysicalNames: ['MBR', 'ORD'], existingId: null,
    }])
  })

  it('익명 관계는 익명으로, 이름 있는 관계는 이름째 왕복한다', () => {
    const anon = plan.relationships.find((r) => r.childPhysicalName === 'ORD')!
    expect(anon).toMatchObject({ cardinality: '1:N', name: null })
    const named = plan.relationships.find((r) => r.childPhysicalName === 'MBR_DTL')!
    expect(named).toMatchObject({ cardinality: '1:1', name: 'FK_MBR_DTL_MBR' })
  })

  it('1:1 이 유니크 인덱스를 만들지 않는다', () => {
    const dtl = plan.tables.find((t) => t.physicalName === 'MBR_DTL')!
    expect(dtl.indexes).toEqual([])
  })
})
