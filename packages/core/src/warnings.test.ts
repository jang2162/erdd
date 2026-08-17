import { describe, expect, it } from 'vitest'
import { computeWarnings } from './warnings.js'
import type { Column, CustomField, ProjectModel, Relationship, Table, Term, Word } from './model.js'
import { createEmptyModel } from './model.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import { buildSampleModel } from './testing/fixtures.js'

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
  return { id, logicalName, abbreviation, englishName: null, description: null, origin: null }
}
function term(id: string, logicalName: string, physicalName: string): Term {
  return { id, logicalName, physicalName, domainId: null, description: null, origin: null }
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
  const rules: NamingRules = {
  case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
  tablePhysicalTemplate: '',
}

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
      options: ['Y', 'N'], required: true, defaultValue: null, order: 0, origin: null,
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
      options: ['Y', 'N'], required: true, defaultValue: null, order: 0, origin: null,
    }
    m.customFields['f2'] = {
      id: 'f2', name: '암호화방식', target: 'column', type: 'text',
      options: [], required: true, defaultValue: '없음', order: 1, origin: null,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME', { custom: { f1: 'Y' } })
    expect(computeWarnings(m).filter((x) => x.kind === 'custom-required')).toEqual([])
  })

  it('boolean 타입은 필수여도 경고하지 않는다(체크박스는 항상 값이 있다)', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'boolean',
      options: [], required: true, defaultValue: null, order: 0, origin: null,
    }
    m.tables['T'] = tbl('T')
    m.columns['A'] = col('A', 'T', 'NAME')
    expect(computeWarnings(m).filter((x) => x.kind === 'custom-required')).toEqual([])
  })

  it('테이블 대상 필수 항목은 테이블 scope로 경고한다', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '업무구분', target: 'table', type: 'text',
      options: [], required: true, defaultValue: null, order: 0, origin: null,
    }
    m.tables['T'] = tbl('T')
    const w = computeWarnings(m).filter((x) => x.kind === 'custom-required')
    expect(w).toHaveLength(1)
    expect(w[0]!.scope).toBe('table')
    expect(w[0]!.entityId).toBe('T')
  })
})

describe('required-empty', () => {
  it('테이블의 빈 논리명·물리명을 각각 경고한다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.logicalName = ''
    m.tables['t2']!.physicalName = ''
    const ws = computeWarnings(m)
    const t1 = ws.filter((w) => w.kind === 'required-empty' && w.entityId === 't1')
    const t2 = ws.filter((w) => w.kind === 'required-empty' && w.entityId === 't2')
    expect(t1).toHaveLength(1)
    expect(t1[0]!.message).toContain('논리명')
    expect(t1[0]!.scope).toBe('table')
    expect(t2).toHaveLength(1)
    expect(t2[0]!.message).toContain('물리명')
  })

  it('컬럼의 빈 논리명·물리명·타입을 각각 경고하고 tableId를 싣는다', () => {
    const m = buildSampleModel()
    m.columns['c1']!.type = ''
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty' && w.entityId === 'c1')
    expect(ws).toHaveLength(1)
    expect(ws[0]!.scope).toBe('column')
    expect(ws[0]!.tableId).toBe('t1')
    expect(ws[0]!.message).toContain('타입')
  })

  it('한 엔티티에서 여러 필드가 비면 각각 한 건씩 낸다', () => {
    const m = buildSampleModel()
    m.columns['c1']!.logicalName = ''
    m.columns['c1']!.physicalName = ''
    m.columns['c1']!.type = ''
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty' && w.entityId === 'c1')
    expect(ws).toHaveLength(3)
  })

  it('공백만 있는 값도 비어 있는 것으로 본다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.logicalName = '   '
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty' && w.entityId === 't1')
    expect(ws).toHaveLength(1)
  })

  // ⚠️ 이 테스트가 없으면 "항상 경고를 낸다"는 구현도 위 넷을 전부 통과한다.
  it('필수값이 모두 차 있으면 한 건도 내지 않는다', () => {
    const ws = computeWarnings(buildSampleModel()).filter((w) => w.kind === 'required-empty')
    expect(ws).toEqual([])
  })

  // rules 게이트 밖에 있어야 한다 — 명명 규칙을 주지 않아도 나온다.
  it('rules 없이 호출해도 계산된다', () => {
    const m = buildSampleModel()
    m.tables['t1']!.physicalName = ''
    const ws = computeWarnings(m).filter((w) => w.kind === 'required-empty')
    expect(ws.length).toBeGreaterThan(0)
  })
})

describe('findMatchingTerm 구분자 정규화', () => {
  // ⚠️ 용어 매칭은 네 자리(generatePhysicalName · restoreLogicalName · suggestCompletions ·
  // findMatchingTerm)가 같은 정규화를 써야 한다(HANDOFF 3.5b). 여기만 평문 비교로 되돌리면
  // 구분자가 든 논리명에서 term-mismatch 가 통째로 사라지는데, 되돌려도 아무것도 빨개지지
  // 않았다(리뷰 실측).
  const modelWithPair = () => {
    const m = createEmptyModel()
    m.words = {
      w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
      w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
    }
    // 용어 저장값에는 구분자가 없다(공용 라이브러리에서 내려온 모양 — 설계 D4).
    m.terms['tm1'] = {
      id:'tm1', logicalName:'회원주문', physicalName:'MBR_ORD_STD',
      domainId:null, description:null, origin:null,
    }
    m.tables['t1'] = {
      id:'t1', logicalName:'회원_주문', physicalName:'MBR_ORD', comment:null, groupId:null,
      position:{x:0,y:0}, groupPosition:null, custom:{},
    }
    return m
  }

  it('구분자가 든 논리명도 구분자 없는 용어와 매칭돼 term-mismatch 를 낸다', () => {
    const ws = computeWarnings(modelWithPair(), DEFAULT_NAMING_RULES)
    expect(ws.map((w) => w.kind)).toContain('term-mismatch')
  })

  // 대조군 — 구분자를 끈 규칙(옛 세계)에서는 같은 쌍이 만나지 않는다. 이것이 없으면 위 케이스가
  // "언제나 뜨는 경고"와 구분되지 않는다.
  it('구분자를 끈 규칙에서는 같은 쌍이 매칭되지 않는다', () => {
    const ws = computeWarnings(modelWithPair(), { ...DEFAULT_NAMING_RULES, logicalSeparator: '' })
    expect(ws.map((w) => w.kind)).not.toContain('term-mismatch')
  })
})

describe('missing-logical-separator', () => {
  const words = {
    w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
    w2: { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null },
  }
  const modelWith = (logicalName: string) => {
    const m = createEmptyModel()
    m.words = words
    m.tables['t1'] = {
      id:'t1', logicalName, physicalName:'MBR_ORD', comment:null, groupId:null,
      position:{x:0,y:0}, groupPosition:null, custom:{},
    }
    return m
  }
  const kinds = (name: string, rules = DEFAULT_NAMING_RULES) =>
    computeWarnings(modelWith(name), rules).map((w) => w.kind)

  it('구분자 없이 두 단어 이상이면 경고한다', () => {
    expect(kinds('회원주문')).toContain('missing-logical-separator')
  })

  it('구분자가 있으면 경고하지 않는다', () => {
    expect(kinds('회원_주문')).not.toContain('missing-logical-separator')
  })

  // ⚠️ 이것이 없으면 단일 단어 논리명 전부에 경고가 붙어 신호가 죽는다(설계 3.5).
  it('단일 단어에는 경고하지 않는다', () => {
    expect(kinds('회원')).not.toContain('missing-logical-separator')
  })

  it('사전에 없어 한 덩어리로 남는 이름에는 경고하지 않는다', () => {
    expect(kinds('쿠폰')).not.toContain('missing-logical-separator')
  })

  it('구분자 없는 규칙에서는 경고하지 않는다', () => {
    const rules = { ...DEFAULT_NAMING_RULES, logicalSeparator: '' as const }
    expect(kinds('회원주문', rules)).not.toContain('missing-logical-separator')
  })

  it('rules 를 주지 않으면 계산하지 않는다', () => {
    expect(computeWarnings(modelWith('회원주문')).map((w) => w.kind))
      .not.toContain('missing-logical-separator')
  })

  /**
   * ⚠️ **용어와 완전일치하는 옛 형식 논리명** — 기존 프로젝트의 가장 흔한 모양이다.
   * generatePhysicalName 이 1단계(용어 완전일치)에서 조기 반환하므로 `gen.segments` 가 없고,
   * 경고 판정은 그때만 직접 분해하는 **폴백 갈래**를 탄다. 그 갈래를 지우면 이 모양에서만
   * 구분자 경고가 조용히 사라진다(다른 케이스는 전부 2단계를 타므로 아무것도 빨개지지 않는다).
   * 성능 최적화(GenResult.segments 재사용)가 만든 갈래라 그 최적화를 되돌릴 때 함께 본다.
   */
  it('용어와 완전일치하는 옛 형식 논리명에도 경고한다(분해 폴백 갈래)', () => {
    const m = modelWith('회원주문')
    // 용어 저장값도 구분자가 없다 — 논리명과 완전일치해 물리명 생성이 용어로 끝난다.
    m.terms['tm1'] = {
      id:'tm1', logicalName:'회원주문', physicalName:'MBR_ORD',
      domainId:null, description:null, origin:null,
    }
    const ws = computeWarnings(m, DEFAULT_NAMING_RULES)
    // 전제: 용어로 끝났으므로 미등록 단어 경고는 없다(= 2단계 분해를 타지 않았다).
    expect(ws.map((w) => w.kind)).not.toContain('unknown-word')
    expect(ws.map((w) => w.kind)).toContain('missing-logical-separator')
    expect(ws.find((w) => w.kind === 'missing-logical-separator')?.message).toContain('회원_주문')
  })

  it('메시지가 구분자를 넣은 형태를 알려 준다', () => {
    const w = computeWarnings(modelWith('회원주문'), DEFAULT_NAMING_RULES)
      .find((x) => x.kind === 'missing-logical-separator')
    expect(w?.message).toContain('회원_주문')
  })
})
