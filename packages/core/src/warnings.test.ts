import { describe, expect, it } from 'vitest'
import { computeWarnings } from './warnings.js'
import type { Column, CustomField, ProjectModel, Relationship, Table, Term, Word } from './model.js'
import { createEmptyModel } from './model.js'
import type { NamingRules } from './naming.js'

function tbl(id: string, over: Partial<Table> = {}): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {}, ...over }
}
function col(id: string, tableId: string, physicalName: string, over: Partial<Column> = {}): Column {
  return { id, tableId, logicalName: id, physicalName, type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null,
    domainId: null, custom: {}, ...over }
}
function word(id: string, logicalName: string, abbreviation: string): Word {
  return { id, logicalName, abbreviation, description: null }
}
function term(id: string, logicalName: string, physicalName: string): Term {
  return { id, logicalName, physicalName, domainId: null, description: null }
}

describe('computeWarnings', () => {
  it('같은 테이블 물리명 중복을 각 컬럼마다 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME', { order: 0 })
    m.columns['B'] = col('B', 'T', 'NAME', { order: 1 })
    m.columns['C'] = col('C', 'T', 'CODE', { order: 2 })
    const w = computeWarnings(m).filter((x) => x.kind === 'duplicate-physical')
    expect(w.map((x) => x.entityId).sort()).toEqual(['A', 'B'])
  })

  it('다른 테이블의 같은 물리명은 경고하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['T1'] = tbl('T1'); m.tables['T2'] = tbl('T2')
    m.columns['A'] = col('A', 'T1', 'ID'); m.columns['B'] = col('B', 'T2', 'ID')
    expect(computeWarnings(m).filter((x) => x.kind === 'duplicate-physical')).toEqual([])
  })

  it('관계 매핑의 타입 불일치를 경고한다', () => {
    const m = createEmptyModel()
    m.tables['P'] = tbl('P'); m.tables['C'] = tbl('C')
    m.columns['PC'] = col('PC', 'P', 'ID', { type: 'BIGINT', isPk: true })
    m.columns['CC'] = col('CC', 'C', 'PID', { type: 'VARCHAR(20)' })
    const rel: Relationship = { id: 'R', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'CC', parentColumnId: 'PC' }],
      cardinality: '1:N', identifying: false, name: null }
    m.relationships['R'] = rel
    const w = computeWarnings(m).filter((x) => x.kind === 'type-mismatch')
    expect(w).toHaveLength(1)
    expect(w[0]!.entityId).toBe('R')
  })

  it('부모 PK 수와 매핑 수가 다르면 매핑 불완전을 경고한다', () => {
    const m = createEmptyModel()
    m.tables['P'] = tbl('P'); m.tables['C'] = tbl('C')
    m.columns['P1'] = col('P1', 'P', 'ID', { isPk: true, type: 'BIGINT' })
    m.columns['P2'] = col('P2', 'P', 'TENANT', { isPk: true, type: 'BIGINT' })
    m.columns['CC'] = col('CC', 'C', 'PID', { type: 'BIGINT' })
    m.relationships['R'] = { id: 'R', parentTableId: 'P', childTableId: 'C',
      columnMappings: [{ childColumnId: 'CC', parentColumnId: 'P1' }],
      cardinality: '1:N', identifying: false, name: null }
    const w = computeWarnings(m).filter((x) => x.kind === 'incomplete-mapping')
    expect(w).toHaveLength(1)
  })

  it('경고가 없으면 빈 배열', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'ID')
    expect(computeWarnings(m)).toEqual([])
  })
})

describe('computeWarnings — 명명 경고 (rules 지정 시)', () => {
  const rules: NamingRules = { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }

  it('논리명에 미등록 단어가 있으면 unknown-word를 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T', { logicalName: '' })
    m.words['w1'] = word('w1', '회원', 'MBR')
    m.columns['A'] = col('A', 'T', 'MBR_CPN', { logicalName: '회원쿠폰' })
    const ws = computeWarnings(m, rules).filter((w) => w.kind === 'unknown-word')
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ entityId: 'A', scope: 'column', tableId: 'T' })
  })

  it('용어와 논리명은 일치하지만 물리명이 다르면 term-mismatch를 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T', { logicalName: '' })
    m.terms['t1'] = term('t1', '주문번호', 'ORD_NO')
    m.columns['A'] = col('A', 'T', 'ORDER_NUMBER', { logicalName: '주문번호' })
    const ws = computeWarnings(m, rules).filter((w) => w.kind === 'term-mismatch')
    expect(ws).toHaveLength(1)
    expect(ws[0]!.entityId).toBe('A')

    // 물리명이 용어의 표준 물리명과 같으면 경고하지 않는다
    m.columns['A'] = col('A', 'T', 'ORD_NO', { logicalName: '주문번호' })
    expect(computeWarnings(m, rules).filter((w) => w.kind === 'term-mismatch')).toEqual([])
  })

  it('물리명 바이트 길이가 규칙을 초과하면 too-long을 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T', { logicalName: '' })
    m.columns['A'] = col('A', 'T', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_EXTRA', { logicalName: '' })
    const ws = computeWarnings(m, { ...rules, maxLengthBytes: 5 }).filter((w) => w.kind === 'too-long')
    expect(ws).toHaveLength(1)
    expect(ws[0]!.entityId).toBe('A')
  })

  it('물리명이 지정된 방언의 예약어이면 reserved를 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T', { logicalName: '', physicalName: 'ORDER' })
    const ws = computeWarnings(m, rules, ['postgresql']).filter((w) => w.kind === 'reserved')
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ entityId: 'T', scope: 'table' })
    // 예약어가 아닌 방언 목록만 주어지면 경고하지 않는다
    const m2 = createEmptyModel()
    m2.tables['T'] = tbl('T', { logicalName: '', physicalName: 'CUSTOMER' })
    expect(computeWarnings(m2, rules, ['postgresql']).filter((w) => w.kind === 'reserved')).toEqual([])
  })

  it('테이블 물리명이 다른 테이블과 중복되면 duplicate-physical-table을 severity error로 경고한다', () => {
    const m = createEmptyModel()
    m.tables['T1'] = tbl('T1', { logicalName: '', physicalName: 'SHARED' })
    m.tables['T2'] = tbl('T2', { logicalName: '', physicalName: 'SHARED' })
    const ws = computeWarnings(m, rules).filter((w) => w.kind === 'duplicate-physical-table')
    expect(ws.map((w) => w.entityId).sort()).toEqual(['T1', 'T2'])
    expect(ws.every((w) => w.severity === 'error')).toBe(true)
  })

  it('rules/dialects 없이 호출하면 명명 경고를 추가하지 않는다(하위호환)', () => {
    const m = createEmptyModel()
    m.tables['T1'] = tbl('T1', { logicalName: '', physicalName: 'ORDER' })
    m.tables['T2'] = tbl('T2', { logicalName: '', physicalName: 'ORDER' })
    m.words['w1'] = word('w1', '회원', 'MBR')
    m.terms['t1'] = term('t1', '주문번호', 'ORD_NO')
    m.columns['A'] = col('A', 'T1', 'ORDER_NUMBER', { logicalName: '주문번호쿠폰' })
    const namingKinds = ['unknown-word', 'term-mismatch', 'too-long', 'reserved', 'duplicate-physical-table']
    expect(computeWarnings(m).every((w) => !namingKinds.includes(w.kind))).toBe(true)
  })

  it('필수 커스텀 항목이 비어 있으면 경고한다(rules 없이 호출해도 계산된다)', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'select',
      options: ['Y', 'N'], required: true, defaultValue: null, order: 0,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME')
    const w = computeWarnings(m).filter((x) => x.kind === 'custom-required')
    expect(w).toHaveLength(1)
    expect(w[0]!.entityId).toBe('A')
    expect(w[0]!.tableId).toBe('T')
    expect(w[0]!.message).toContain('개인정보여부')
  })

  it('값이 있거나 기본값이 있으면 필수 경고를 내지 않는다', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'select',
      options: ['Y', 'N'], required: true, defaultValue: null, order: 0,
    }
    m.customFields['f2'] = {
      id: 'f2', name: '암호화방식', target: 'column', type: 'text',
      options: [], required: true, defaultValue: '없음', order: 1,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME', { custom: { f1: 'Y' } })
    expect(computeWarnings(m).filter((x) => x.kind === 'custom-required')).toEqual([])
  })

  it('boolean 타입은 필수여도 경고하지 않는다(체크박스는 항상 값이 있다)', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: true, defaultValue: null, order: 0,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME')
    expect(computeWarnings(m).filter((x) => x.kind === 'custom-required')).toEqual([])
  })

  it('테이블 대상 필수 항목은 테이블 scope로 경고한다', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '업무구분', target: 'table', type: 'text',
      options: [], required: true, defaultValue: null, order: 0,
    }
    m.tables['T'] = tbl('T')
    const w = computeWarnings(m).filter((x) => x.kind === 'custom-required')
    expect(w).toHaveLength(1)
    expect(w[0]!.scope).toBe('table')
    expect(w[0]!.entityId).toBe('T')
  })
})
