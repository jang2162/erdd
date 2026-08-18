import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { generateDbml as generateDbmlRaw } from './dbml.js'
import { parseDbml } from './dbml-parse.js'
import { buildSampleModel } from './testing/fixtures.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import type { DdlScope } from './ddl.js'
import type { Dialect } from './dialect.js'

// 이 파일의 기존 케이스는 전부 「템플릿 없는 규칙」을 전제한다 — 심으로 그 전제를 한 줄에 적고
// 호출부 20곳을 그대로 둔다.
const generateDbml = (
  model: ProjectModel, dialect: Dialect, scope: DdlScope = { kind: 'all' },
  opts: { projectName?: string } = {}, rules: NamingRules = DEFAULT_NAMING_RULES,
) => generateDbmlRaw(model, dialect, scope, opts, rules)

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
    // 양끝이 작은따옴표라는 이유로 표현식을 문자열 리터럴로 오탐하면 의미가 바뀐다 —
    // 'a' || 'b'(문자열 연결)가 "a' || 'b"라는 글자 하나로 왕복했다(리뷰 m-2).
    it('양끝이 따옴표인 표현식을 리터럴로 오탐하지 않는다', () => {
      expect(withDefault("'a' || 'b'")).toContain("default: `'a' || 'b'`")
    })
    it('내부 이스케이프 따옴표가 든 리터럴은 그대로 문자열이다', () => {
      expect(withDefault("'it''s'")).toContain("default: 'it\\'s'")
    })
  })

  // rawDefaultToDbml 과 dbmlDefaultToRaw 가 정확히 역이 아니면 백슬래시가 **왕복마다 두 배로**
  // 늘어난다. 한 번만 돌리면 "한 번 늘어난 값"이 그럴듯해 보이므로 두 번 연속 돌려 잠근다.
  describe('기본값의 이스케이프 왕복', () => {
    /** 모델 원문 → DBML → 모델 원문. */
    const roundTrip = (raw: string): string => {
      const m = baseModel()
      m.columns['c2']!.defaultValue = raw
      return parseDbml(generateDbml(m, 'postgresql')).tables[0]!.columns[1]!.defaultValue!
    }

    it('백슬래시가 든 문자열 기본값이 두 번 왕복해도 늘어나지 않는다', () => {
      const raw = "'C:\\temp\\n_not_newline'"
      const once = roundTrip(raw)
      expect(once).toBe(raw)
      expect(roundTrip(once)).toBe(raw)
    })

    it('백슬래시가 든 표현식 기본값이 두 번 왕복해도 늘어나지 않는다', () => {
      const raw = "regexp_replace(X, '\\\\', '')"
      const once = roundTrip(raw)
      expect(once).toBe(raw)
      expect(roundTrip(once)).toBe(raw)
    })

    it('백슬래시로 끝나는 표현식 기본값이 테이블을 삼키지 않는다', () => {
      // M-2 와 같은 렉서 위험이 표현식(백틱) 경로에도 있다 — 닫는 백틱이 이스케이프로 먹힌다.
      const m = baseModel()
      m.columns['c2']!.defaultValue = 'X\\'
      const p = parseDbml(generateDbml(m, 'postgresql'))
      expect(p.tables).toHaveLength(1)
      // 테이블 수만 보면 약하다 — 블록이 "닫히지 않음"으로 떨어져도 본문을 끝까지 먹어 1개가 된다.
      expect(p.skipped).toEqual([])
      expect(p.tables[0]!.columns[1]!.defaultValue).toBe('X\\')
    })

    it('SQL 이스케이프 따옴표가 든 리터럴도 두 번 왕복해도 그대로다(대조군)', () => {
      const raw = "'it''s'"
      const once = roundTrip(raw)
      expect(once).toBe(raw)
      expect(roundTrip(once)).toBe(raw)
    })
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
  m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#0E7A6C', comment: null, alias: '' }
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

describe('물리명 템플릿', () => {
  const tpl = (t: string): NamingRules => ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: t })
  const TPL = 'TB_{그룹별칭}_{물리명}'
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }

  it('Table·Ref·그룹 멤버가 조합된 이름을 쓴다', () => {
    const out = generateDbml(m(), 'postgresql', { kind: 'all' }, {}, tpl(TPL))
    expect(out).toContain('Table "TB_MBR_MBR" ')
    expect(out).toContain('Table "TB_MBR_MBR_GRD" ')
    expect(out).toContain('Ref: "TB_MBR_MBR".')          // 자식(MBR) 쪽
    expect(out).toContain('"TB_MBR_MBR_GRD".')           // 부모 쪽
    expect(out).toMatch(/TableGroup [^\n]*\{\n\s+"TB_MBR_/)
    expect(out).not.toMatch(/Table "MBR_GRD"/)
    expect(out).not.toMatch(/Table "MBR"/)
  })

  // note 는 물리명을 **찍지 않는다** — `commentText(논리명, 물리명, 설명)` 의 「논리명==물리명이면
  // 생략」 판정에만 쓴다(dbml-note.ts). 그 판정이 조합 이름과 비교돼야 한다.
  it('note 의 논리명 생략 판정이 조합 이름 기준이다', () => {
    const x = m()
    // 논리명 == 부분 물리명 == 'ORD', 설명 없음 → 템플릿이 없으면 note 자체가 안 나온다.
    x.tables['t2'] = { ...x.tables['t2']!, logicalName: 'ORD', physicalName: 'ORD', comment: null }
    expect(generateDbml(x, 'postgresql')).not.toContain("note: 'ORD'")
    // 조합하면 'TB_MBR_ORD' 라 논리명과 달라진다 → 논리명이 note 로 나온다.
    expect(generateDbml(x, 'postgresql', { kind: 'all' }, {}, tpl(TPL))).toContain("note: 'ORD'")
  })

  it('템플릿이 없으면 지금과 같다', () => {
    expect(generateDbml(m(), 'postgresql')).toContain('Table "MBR" ')
  })
})

describe('논리명 템플릿', () => {
  const both = (physical: string, logical: string): NamingRules => ({
    ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: physical, tableLogicalTemplate: logical,
  })
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    return x
  }

  it('note 의 논리명이 조합된다', () => {
    const out = generateDbmlRaw(m(), 'postgresql', { kind: 'all' }, {}, both('', '{그룹명}_{논리명}'))
    expect(out).toContain("note: 'SALES_회원 - 서비스 가입 회원'")
  })

  // ⚠️ 생략 판정도 조합끼리다(설계 D5) — DDL 과 같은 성질이 note 에도 있다.
  it('note 생략 판정이 조합끼리 비교된다', () => {
    const x = m()
    x.tables['t2'] = { ...x.tables['t2']!, logicalName: 'ORD', physicalName: 'ORD', comment: null }
    const out = generateDbmlRaw(
      x, 'postgresql', { kind: 'all' }, {}, both('{그룹명}_{물리명}', '{그룹명}_{논리명}'))
    expect(out).toContain('Table "SALES_ORD"')
    // ⚠️ `not.toContain("note: 'SALES_ORD'")` 만으로는 구분이 안 된다 — 고치기 전에는 note 가
    // 부분('ORD')이라 그 단언이 그냥 통과한다. 그 테이블의 설정 목록에 note 가 **아예 없어야** 한다.
    const settings = /Table "SALES_ORD" \[([^\]]*)\]/.exec(out)?.[1] ?? ''
    expect(settings).not.toContain('note:')
  })

  it('템플릿이 없으면 지금과 같다', () => {
    expect(generateDbmlRaw(m(), 'postgresql', { kind: 'all' }, {}, DEFAULT_NAMING_RULES))
      .toContain("note: '회원 - 서비스 가입 회원'")
  })
})

