import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Column, type ProjectModel } from './model.js'
import { generateDbml as generateDbmlRaw } from './dbml.js'
import { parseDbml } from './dbml-parse.js'
import { buildSampleModel } from './testing/fixtures.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import type { DdlScope } from './ddl.js'
import type { Dialect } from './dialect.js'
import { parseNameMeta } from './name-meta.js'

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


describe('머릿말 메타', () => {
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }
  const tpl = (t: string): NamingRules => ({ ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: t })

  /** 그룹을 뗀 모델. D4 의 좁아진 보장(「그룹도 템플릿도 안 쓰는 프로젝트」)을 재는 자다. */
  function ungrouped(): ProjectModel {
    const x = m()
    x.tables['t1'] = { ...x.tables['t1']!, groupId: null }
    x.tables['t2'] = { ...x.tables['t2']!, groupId: null }
    return x
  }

  it('템플릿이 걸리면 첫 줄에 // 머릿말이 나온다', () => {
    const out = generateDbmlRaw(
      m(), 'postgresql', { kind: 'all' }, {}, tpl('TB_{그룹별칭}_{물리명}'))
    expect(out.split('\n')[0]!.startsWith('// erdd:v2 ')).toBe(true)
  })

  // ⚠️ 머릿말은 Project 블록보다 **앞**이어야 파싱이 줍는다(설계 3.4).
  it('머릿말이 Project 블록보다 앞에 온다', () => {
    const out = generateDbmlRaw(
      m(), 'postgresql', { kind: 'all' }, { projectName: '회원 시스템' },
      tpl('TB_{그룹별칭}_{물리명}'))
    expect(out.indexOf('// erdd:v2')).toBeLessThan(out.indexOf('Project '))
    expect(parseNameMeta(out)).not.toBeNull()
  })

  // ⚠️ 설계 D4(좁아짐) — 그룹도 템플릿도 없어야 기존 산출물 무변경이 보장된다.
  it('그룹도 템플릿도 없으면 머릿말이 없다', () => {
    expect(parseNameMeta(generateDbmlRaw(ungrouped(), 'postgresql', { kind: 'all' }, {}, DEFAULT_NAMING_RULES)))
      .toBeNull()
  })

  // ⚠️ 이번 사이클이 넓힌 자리 — 템플릿이 없어도 그룹이 있으면 머릿말이 나간다.
  it('템플릿이 없어도 그룹이 있으면 // 머릿말이 나온다', () => {
    const out = generateDbmlRaw(m(), 'postgresql', { kind: 'all' }, {}, DEFAULT_NAMING_RULES)
    expect(out.split('\n')[0]!.startsWith('// erdd:v2 ')).toBe(true)
  })
})

// ── MySQL nullable TIMESTAMP ────────────────────────────────────────────────

/**
 * DBML 은 DDL 과 같은 물리 타입 문자열을 내는 **두 번째 출구**다. nullable 을 적지 않으면
 * dbdiagram 같은 도구가 이 DBML 을 MySQL DDL 로 되돌릴 때 `explicit_defaults_for_timestamp = 0`
 * 서버의 함정(`NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`)으로 그대로
 * 돌아간다 — nullable 로 설계한 컬럼이 UPDATE 마다 조용히 바뀐다.
 *
 * 판정은 DDL 쪽과 **같은 범위**다 — mysql 이고 실제로 나가는 물리 타입(`r.sql`)이 TIMESTAMP 로
 * 시작하는 nullable 컬럼만이다. nullable 인 모든 컬럼이 아니다.
 */
describe('generateDbml — MySQL nullable TIMESTAMP', () => {
  function tsModel(over: Partial<Column> = {}): ProjectModel {
    const m = createEmptyModel()
    m.tables['t'] = {
      id: 't', logicalName: 'ORD', physicalName: 'ORD', comment: null, groupId: null,
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c1'] = {
      id: 'c1', tableId: 't', logicalName: 'ORD_NO', physicalName: 'ORD_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    m.columns['c2'] = {
      id: 'c2', tableId: 't', logicalName: 'REG_DT', physicalName: 'REG_DT', type: 'TIMESTAMPTZ',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 1,
      comment: null, domainId: null, custom: {}, ...over,
    }
    return m
  }
  /** mysql 물리 타입을 도메인 오버라이드로만 정하는 모델(논리 타입은 TIMESTAMP 가 아니다). */
  function overrideModel(mysqlType = 'TIMESTAMP'): ProjectModel {
    const m = tsModel()
    m.domains['d'] = {
      id: 'd', name: '등록일시', category: null, logicalType: 'DATETIME',
      dialectTypes: { postgresql: null, mysql: mysqlType, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    m.columns['c2'] = { ...m.columns['c2']!, type: '', domainId: 'd' }
    return m
  }
  const line = (out: string, name: string): string =>
    out.split('\n').find((l) => l.trim().startsWith(`"${name}"`))!.trim()
  /** 그 컬럼의 설정 목록. `not null` 이 `null` 을 부분 문자열로 품으므로 토큰으로 갈라 본다. */
  const settingsOf = (out: string, name: string): string[] => {
    const m = /\[(.*)\]$/.exec(line(out, name))
    return m === null ? [] : m[1]!.split(', ')
  }

  it('nullable TIMESTAMP 에 null 을 명시한다', () => {
    const out = generateDbml(tsModel(), 'mysql')
    expect(line(out, 'REG_DT')).toBe('"REG_DT" TIMESTAMP [null]')
  })

  // ⚠️ 논리 타입으로 판정하면 이 경로가 조용히 빠진다 — 오버라이드가 물리 타입을 갈아치운다.
  it('도메인의 mysql 물리 타입 오버라이드가 TIMESTAMP 여도 null 이 붙는다', () => {
    expect(line(generateDbml(overrideModel(), 'mysql'), 'REG_DT')).toBe('"REG_DT" TIMESTAMP [null]')
  })

  // 타입 조건 단독 잠금 — dialect 가드가 사라져도 이 케이스는 안 걸린다.
  it('mysql 이어도 TIMESTAMP 가 아니면 null 을 붙이지 않는다', () => {
    const out = generateDbml(tsModel({ type: 'VARCHAR(100)' }), 'mysql')
    expect(line(out, 'REG_DT')).toContain('"REG_DT" VARCHAR(100)')
    expect(settingsOf(out, 'REG_DT')).not.toContain('null')
  })

  it('NOT NULL TIMESTAMP 는 그대로이고 null 이 겹쳐 붙지 않는다', () => {
    const out = generateDbml(tsModel({ nullable: false }), 'mysql')
    expect(line(out, 'REG_DT')).toBe('"REG_DT" TIMESTAMP [not null]')
  })

  /**
   * 방언 조건 단독 잠금 — 타입 가드가 살아 있어도 mysql 가드가 사라지면 걸려야 한다.
   *
   * ⚠️ **postgresql + TIMESTAMPTZ 로는 이 조건이 안 잠긴다**(DDL 쪽에서 실측). 그 조합의 물리
   * 타입은 `timestamptz` 라 `/^TIMESTAMP\b/` 의 단어 경계에서 이미 떨어져 나가므로 mysql 가드를
   * 지워도 초록으로 남는다. 물리 타입이 **실제로 TIMESTAMP 로 시작하는** 비 mysql 조합을 골라야
   * 한다 — postgresql 의 DATETIME(`timestamp`) 과 oracle 의 TIMESTAMPTZ(`TIMESTAMP WITH TIME ZONE`).
   */
  it('mysql 이 아닌 방언은 물리 타입이 TIMESTAMP 로 시작해도 null 을 붙이지 않는다', () => {
    const pg = generateDbml(tsModel({ type: 'DATETIME' }), 'postgresql')
    expect(line(pg, 'REG_DT')).toContain('"REG_DT" timestamp')
    expect(settingsOf(pg, 'REG_DT')).not.toContain('null')
    const ora = generateDbml(tsModel(), 'oracle')
    expect(line(ora, 'REG_DT')).toContain('"REG_DT" TIMESTAMP WITH TIME ZONE')
    expect(settingsOf(ora, 'REG_DT')).not.toContain('null')
  })

  /**
   * ⚠️ pk 를 낸 컬럼에는 null 을 덧붙이지 않는다 — DBML 에서 `[pk, null]` 은 모순이고, 가져오기가
   * `nullable: !notNull && !isPk` 로 판정해 어차피 pk 가 이긴다. 이 조합은 실제로 도달 가능하다
   * (웹 편집기의 PK 체크박스가 `isPk` 만 바꾸고 `nullable` 을 끄지 않는다).
   */
  it('inlinePk 인 nullable TIMESTAMP 에는 pk 만 나오고 null 이 붙지 않는다', () => {
    const m = tsModel({ isPk: true })
    m.columns['c1'] = { ...m.columns['c1']!, isPk: false }   // 단일 PK 로 만들어 인라인 pk 를 낸다
    expect(line(generateDbml(m, 'mysql'), 'REG_DT')).toBe('"REG_DT" TIMESTAMP [pk]')
  })
})
