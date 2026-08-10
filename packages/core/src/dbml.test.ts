import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { generateDbml } from './dbml.js'
import { parseDbml } from './dbml-parse.js'

function baseModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: '회원 기본정보',
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  return m
}

describe('generateDbml', () => {
  it('식별자를 큰따옴표로 감싸고 컬럼 설정을 낸다', () => {
    const out = generateDbml(baseModel(), 'postgresql')
    expect(out).toContain('Table "MBR" [note: \'회원 - 회원 기본정보\'] {')
    expect(out).toContain('"MBR_NO" bigint [pk, increment, note: \'회원번호\']')
    expect(out).toContain('"MBR_NM" varchar(100) [not null, note: \'회원명\']')
  })

  it('projectName 을 주면 Project 블록을 낸다', () => {
    const out = generateDbml(baseModel(), 'oracle', { kind: 'all' }, { projectName: '회원 관리' })
    expect(out.startsWith('Project "회원 관리" {\n  database_type: \'Oracle\'\n}')).toBe(true)
  })

  it('projectName 이 없으면 Project 블록을 내지 않는다', () => {
    expect(generateDbml(baseModel(), 'postgresql')).not.toContain('Project ')
  })

  it('0컬럼 테이블과 빈 물리명 테이블은 제외한다', () => {
    const m = baseModel()
    m.tables['t2'] = {
      id: 't2', logicalName: '빈테이블', physicalName: 'EMPTY', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables['t3'] = {
      id: 't3', logicalName: '이름없음', physicalName: '', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c9'] = {
      id: 'c9', tableId: 't3', logicalName: '컬럼', physicalName: 'C', type: 'INT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {},
    }
    const out = generateDbml(m, 'postgresql')
    expect(out).not.toContain('EMPTY')
    expect(out).not.toContain('이름없음')
  })

  it('작은따옴표·개행이 든 설명을 안전하게 낸다', () => {
    const m = baseModel()
    m.tables['t1']!.comment = "it's\n두 줄"
    const out = generateDbml(m, 'postgresql')
    expect(out).toContain("note: '''회원 - it's\n두 줄'''")
  })

  // 트리플 쿼트 경로가 백슬래시를 이스케이프하지 않아 (a) 설명이 백슬래시로 끝나면 닫는
  // 따옴표를 렉서가 못 보고 테이블이 통째로 사라지고, (b) 리터럴 백슬래시+글자가 제어문자로
  // 변조됐다(리뷰 M-2). 한 줄 경로는 처음부터 이스케이프하고 있었다 — 비대칭이었다.
  describe('여러 줄 설명의 백슬래시', () => {
    const withComment = (comment: string) => {
      const m = baseModel()
      m.tables['t1']!.comment = comment
      return generateDbml(m, 'postgresql')
    }

    it('백슬래시로 끝나는 여러 줄 설명이 테이블을 삼키지 않는다', () => {
      const out = withComment('첫 줄\n둘째 줄\\')
      expect(parseDbml(out).tables).toHaveLength(1)
      expect(parseDbml(out).comments).toContainEqual({
        table: 'MBR', column: null, text: '회원 - 첫 줄\n둘째 줄\\',
      })
    })

    it('리터럴 백슬래시+글자를 제어문자로 바꾸지 않는다', () => {
      const out = withComment('첫 줄\n경로: C:\\temp\\n_not_newline')
      expect(parseDbml(out).comments[0]!.text)
        .toBe('회원 - 첫 줄\n경로: C:\\temp\\n_not_newline')
    })

    it('트리플 쿼트가 든 여러 줄 설명은 그대로 왕복한다(대조군)', () => {
      const out = withComment("따옴표 '''셋''' 이 든\n두 줄")
      expect(parseDbml(out).comments[0]!.text).toBe("회원 - 따옴표 '''셋''' 이 든\n두 줄")
    })
  })

  describe('default 표현', () => {
    const withDefault = (v: string) => {
      const m = baseModel()
      m.columns['c2']!.defaultValue = v
      return generateDbml(m, 'postgresql')
    }
    it('문자열 리터럴', () => expect(withDefault("'ACTIVE'")).toContain("default: 'ACTIVE'"))
    it('숫자', () => expect(withDefault('0')).toContain('default: 0'))
    it('불리언', () => expect(withDefault('TRUE')).toContain('default: true'))
    it('NULL', () => expect(withDefault('NULL')).toContain('default: null'))
    it('표현식은 백틱', () => expect(withDefault('now()')).toContain('default: `now()`'))
  })

  it('autoIncrement 는 PK 이고 정수일 때만 increment 로 낸다', () => {
    const m = baseModel()
    m.columns['c2']!.autoIncrement = true            // PK 가 아니다
    expect(generateDbml(m, 'postgresql')).not.toContain('"MBR_NM" varchar(100) [increment')
  })

  // 리뷰 M-3 의 실전형 재현을 왕복으로 잠근다 — 값에 따옴표·중괄호·JSON 문자열이 들어도
  // 커스텀이 전부 유실되고 JSON 원문이 설명으로 새던 자리다.
  it('값에 중괄호·따옴표가 든 커스텀도 설명과 함께 왕복한다', () => {
    const m = baseModel()
    m.customFields['f1'] = {
      id: 'f1', name: '비고', target: 'table', type: 'text', options: [],
      required: false, defaultValue: null, order: 0, origin: null,
    }
    m.customFields['f2'] = {
      id: 'f2', name: '메타', target: 'table', type: 'text', options: [],
      required: false, defaultValue: null, order: 1, origin: null,
    }
    m.tables['t1']!.comment = '설명에 {중괄호} 가 있다'
    m.tables['t1']!.custom = { f1: `it's {중괄호} "큰따옴표"`, f2: '{"a":1}' }
    const parsed = parseDbml(generateDbml(m, 'postgresql'))
    expect(parsed.customValues).toContainEqual({
      table: 'MBR', column: null,
      values: { 비고: `it's {중괄호} "큰따옴표"`, 메타: '{"a":1}' },
    })
    expect(parsed.comments).toContainEqual({
      table: 'MBR', column: null, text: '회원 - 설명에 {중괄호} 가 있다',
    })
  })

  it('커스텀 항목 값을 note 꼬리로 낸다', () => {
    const m = baseModel()
    m.customFields['f1'] = {
      id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
      required: false, defaultValue: null, order: 0, origin: null,
    }
    m.tables['t1']!.custom = { f1: '2' }
    expect(generateDbml(m, 'postgresql')).toContain('{"보안등급":"2"}')
  })
})

function relModel(): ProjectModel {
  const m = baseModel()
  m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#0E7A6C', comment: null }
  m.tables['t1']!.groupId = 'g1'
  m.tables['t2'] = {
    id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c3'] = {
    id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  m.relationships['r1'] = {
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: false, name: null,
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
    columns: [{ columnId: 'c2', direction: 'asc' }],
  }
  return m
}

describe('generateDbml — 인덱스·그룹·관계', () => {
  it('인덱스를 indexes 블록으로 내고 이름을 보존한다', () => {
    expect(generateDbml(relModel(), 'postgresql'))
      .toContain('  indexes {\n    ("MBR_NM") [name: \'IX_MBR_NM\']\n  }')
  })

  it('유니크 인덱스에 unique 설정을 붙인다', () => {
    const m = relModel()
    m.indexes['ix1']!.unique = true
    expect(generateDbml(m, 'postgresql')).toContain("[unique, name: 'IX_MBR_NM']")
  })

  it('복합 PK 는 indexes 블록의 pk 로 낸다', () => {
    const m = relModel()
    m.columns['c4']!.isPk = true
    const out = generateDbml(m, 'postgresql')
    expect(out).toContain('("ORD_NO", "MBR_NO") [pk]')
    expect(out).not.toContain('"ORD_NO" bigint [pk')
  })

  it('그룹을 TableGroup 으로 내고 색을 6자리로 편다', () => {
    const m = relModel()
    m.tableGroups['g1']!.color = '#abc'
    const out = generateDbml(m, 'postgresql')
    expect(out).toContain('TableGroup "회원 관리" [color: #aabbcc] {\n  "MBR"\n  "ORD"\n}')
  })

  it('이름 없는 관계는 익명 Ref 로 낸다', () => {
    expect(generateDbml(relModel(), 'postgresql'))
      .toContain('Ref: "ORD"."MBR_NO" > "MBR"."MBR_NO"')
  })

  it('이름 있는 관계만 이름을 붙인다', () => {
    const m = relModel()
    m.relationships['r1']!.name = 'FK_ORD_MBR'
    expect(generateDbml(m, 'postgresql'))
      .toContain('Ref "FK_ORD_MBR": "ORD"."MBR_NO" > "MBR"."MBR_NO"')
  })

  it('1:1 은 - 로 낸다', () => {
    const m = relModel()
    m.relationships['r1']!.cardinality = '1:1'
    expect(generateDbml(m, 'postgresql')).toContain('Ref: "ORD"."MBR_NO" - "MBR"."MBR_NO"')
  })

  it('합성 FK 는 괄호로 묶는다', () => {
    const m = relModel()
    m.relationships['r1']!.columnMappings = [
      { childColumnId: 'c4', parentColumnId: 'c1' },
      { childColumnId: 'c3', parentColumnId: 'c2' },
    ]
    expect(generateDbml(m, 'postgresql'))
      .toContain('Ref: "ORD".("MBR_NO", "ORD_NO") > "MBR".("MBR_NO", "MBR_NM")')
  })

  it('범위가 좁혀지면 TableGroup·Ref 도 함께 좁혀진다', () => {
    const m = relModel()
    const out = generateDbml(m, 'postgresql', { kind: 'tables', tableIds: ['t1'] })
    expect(out).not.toContain('Ref:')
    expect(out).toContain('TableGroup "회원 관리" [color: #0E7A6C] {\n  "MBR"\n}')
  })
})
