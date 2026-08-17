import { describe, expect, it } from 'vitest'
import { buildSampleModel } from './testing/fixtures.js'
import type { ProjectModel } from './model.js'
import { createEmptyModel } from './model.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import {
  buildChangeSheet, buildDictTemplateSheets, buildExcelSheets as buildExcelSheetsRaw,
  CHANGE_HEADERS, EXCEL_SHEET_NAME, type ExcelSheetKey,
} from './excel-sheets.js'
import type { ExportScope } from './ddl.js'
import { diffModelsForDisplay } from './model-diff.js'

// 이 파일의 기존 케이스는 전부 「템플릿 없는 규칙」을 전제한다 — 심으로 그 전제를 한 줄에 적고
// 호출부 15곳을 그대로 둔다.
// ⚠️ `{ rules: DEFAULT_NAMING_RULES, ...opts }` 순서로 쓰지 마라 — opts.rules 가 명시적
// undefined 면 기본값을 덮어 다시 깨진다.
const buildExcelSheets = (
  model: ProjectModel,
  opts: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[]; rules?: NamingRules } = {},
) => buildExcelSheetsRaw(model, { ...opts, rules: opts.rules ?? DEFAULT_NAMING_RULES })

/** 시트 key로 하나를 꺼낸다(없으면 테스트 실패를 유도하도록 undefined 반환). */
function sheetOf(sheets: ReturnType<typeof buildExcelSheets>, key: string) {
  return sheets.find((s) => s.key === key)
}

function richModel(): ProjectModel {
  const m = buildSampleModel()
  return {
    ...m,
    domains: {
      d1: {
        id: 'd1', name: '등급코드', category: '코드', logicalType: 'CHAR(2)',
        dialectTypes: { postgresql: 'char(2)', mysql: null, oracle: null, mssql: null },
        defaultValue: "'01'", allowedValues: ['01', '02'], description: '회원 등급', origin: null,
      },
    },
    words: {
      w1: {
        id: 'w1', logicalName: '회원', abbreviation: 'MBR',
        englishName: 'MEMBER', description: null, origin: null,
      },
      w2: {
        id: 'w2', logicalName: '번호', abbreviation: 'NO',
        englishName: null, description: '순번', origin: null,
      },
    },
    terms: {
      tm1: {
        id: 'tm1', logicalName: '회원번호', physicalName: 'MBR_NO',
        domainId: 'd1', description: '회원 식별자', origin: null,
      },
    },
    customFields: {
      cf1: {
        id: 'cf1', name: '업무구분', target: 'table', type: 'text',
        options: [], required: false, defaultValue: '공통', order: 0, origin: null,
      },
      cf2: {
        id: 'cf2', name: '개인정보여부', target: 'column', type: 'select',
        options: ['Y', 'N'], required: false, defaultValue: 'N', order: 0, origin: null,
      },
    },
    columns: {
      ...m.columns,
      c1: { ...m.columns['c1']!, domainId: 'd1', custom: { cf2: 'Y' } },
    },
  }
}

describe('buildExcelSheets', () => {
  it('5개 시트를 고정 순서로 낸다', () => {
    const sheets = buildExcelSheets(buildSampleModel())
    expect(sheets.map((s) => s.key)).toEqual(['tableList', 'tableSpec', 'words', 'terms', 'domains'])
    expect(sheets.map((s) => s.name)).toEqual([
      '테이블 목록', '테이블정의서', '단어사전', '용어사전', '도메인정의서',
    ])
  })

  it('테이블 목록: 그룹·논리명·물리명·설명을 그룹명→물리명 순으로 낸다', () => {
    const s = sheetOf(buildExcelSheets(buildSampleModel()), 'tableList')!
    expect(s.headers).toEqual(['그룹', '논리명', '물리명', '설명'])
    // 정렬은 (그룹명, 물리명) — MBR < MBR_GRD 이므로 t2(회원)가 먼저다.
    expect(s.rows).toEqual([
      ['회원관리', '회원', 'MBR', '서비스 가입 회원'],
      ['회원관리', '회원등급', 'MBR_GRD', ''],
    ])
  })

  it('테이블정의서: 컬럼마다 한 행, 순번은 테이블 안에서 1부터', () => {
    const s = sheetOf(buildExcelSheets(buildSampleModel()), 'tableSpec')!
    expect(s.headers).toEqual([
      '그룹', '테이블 논리명', '테이블 물리명', '순번', '논리명', '물리명',
      '도메인', '타입', 'PK', 'NOT NULL', '기본값', '설명',
    ])
    expect(s.rows).toHaveLength(4)
    expect(s.rows[0]).toEqual([
      '회원관리', '회원', 'MBR', '1', '회원번호', 'MBR_NO', '', 'BIGINT', 'Y', 'Y', '', '',
    ])
  })

  it('순번은 order 값이 아니라 테이블 안에서의 1-based 위치다', () => {
    const m = buildSampleModel()
    // MBR의 컬럼 order를 5·9·20으로 띄워 "위치"와 "order + 1"을 구분할 수 있게 한다.
    const shifted: ProjectModel = {
      ...m,
      columns: {
        ...m.columns,
        c2: { ...m.columns['c2']!, order: 5 },
        c3: { ...m.columns['c3']!, order: 9 },
        c4: { ...m.columns['c4']!, order: 20 },
      },
    }
    const rows = sheetOf(buildExcelSheets(shifted), 'tableSpec')!.rows.filter((r) => r[2] === 'MBR')
    expect(rows.map((r) => r[5])).toEqual(['MBR_NO', 'MBR_NM', 'GRD_CD'])   // order 오름차순 정렬은 유지
    expect(rows.map((r) => r[3])).toEqual(['1', '2', '3'])
  })

  it('도메인 지정 컬럼은 도메인 이름·논리 타입·기본값을 따른다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'tableSpec')!
    const row = s.rows.find((r) => r[5] === 'GRD_CD' && r[2] === 'MBR_GRD')!
    expect(row[6]).toBe('등급코드')     // 도메인
    expect(row[7]).toBe('CHAR(2)')      // 타입
    expect(row[10]).toBe("'01'")        // 기본값(도메인 기본값 라이브 해석)
  })

  it('커스텀 항목을 정의 순서대로 컬럼으로 붙이고 미입력은 기본값으로 채운다', () => {
    const sheets = buildExcelSheets(richModel())
    const list = sheetOf(sheets, 'tableList')!
    expect(list.headers).toEqual(['그룹', '논리명', '물리명', '설명', '업무구분'])
    expect(list.rows.every((r) => r[4] === '공통')).toBe(true)

    const spec = sheetOf(sheets, 'tableSpec')!
    expect(spec.headers.at(-1)).toBe('개인정보여부')
    const withValue = spec.rows.find((r) => r[5] === 'GRD_CD' && r[2] === 'MBR_GRD')!
    expect(withValue.at(-1)).toBe('Y')                        // 입력값
    const withDefault = spec.rows.find((r) => r[5] === 'MBR_NO')!
    expect(withDefault.at(-1)).toBe('N')                      // 정의 기본값
  })

  it('커스텀 항목 정의가 없으면 추가 컬럼이 붙지 않는다', () => {
    const s = sheetOf(buildExcelSheets(buildSampleModel()), 'tableList')!
    expect(s.headers).toHaveLength(4)
  })

  it('단어사전: 논리명순으로 논리명·약어·영문명·설명을 낸다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'words')!
    expect(s.headers).toEqual(['논리명', '약어', '영문명', '설명'])
    expect(s.rows).toEqual([
      ['번호', 'NO', '', '순번'],
      ['회원', 'MBR', 'MEMBER', ''],
    ])
  })

  it('용어사전: 구성 단어를 매칭·미매칭 모두 이어붙이고 기본 도메인 이름을 낸다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'terms')!
    expect(s.headers).toEqual(['용어', '구성 단어', '물리명', '기본 도메인', '설명'])
    expect(s.rows).toEqual([['회원번호', '회원, 번호', 'MBR_NO', '등급코드', '회원 식별자']])
  })

  // 「구성 단어」는 분해 결과라 프로젝트의 논리명 구분자 규칙에 따라 달라진다. 규칙을 넘기지
  // 않으면 구분자를 끈 프로젝트에서 '_' 가 단어 사이에 낀 채 분해돼 실제와 어긋난다.
  it('용어사전: 구성 단어는 넘겨받은 명명 규칙으로 분해한다', () => {
    const m = richModel()
    m.terms['tm1']!.logicalName = '회원_번호'
    const withSep = sheetOf(buildExcelSheets(m, { rules: DEFAULT_NAMING_RULES }), 'terms')!
    expect(withSep.rows[0]![1]).toBe('회원, 번호')

    const noSep = sheetOf(
      buildExcelSheets(m, { rules: { ...DEFAULT_NAMING_RULES, logicalSeparator: '' } }), 'terms',
    )!
    expect(noSep.rows[0]![1]).toBe('회원, _, 번호')
  })

  it('도메인정의서: 방언별 타입과 허용값을 낸다', () => {
    const s = sheetOf(buildExcelSheets(richModel()), 'domains')!
    expect(s.headers).toEqual([
      '이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명',
    ])
    expect(s.rows).toEqual([
      ['등급코드', '코드', 'CHAR(2)', 'char(2)', '', '', '', "'01'", '01, 02', '회원 등급'],
    ])
  })

  it('scope=group은 테이블 시트만 좁히고 사전 3시트는 전체를 유지한다', () => {
    const m = richModel()
    const scoped: ProjectModel = {
      ...m,
      tables: { ...m.tables, t2: { ...m.tables['t2']!, groupId: null } },
    }
    const sheets = buildExcelSheets(scoped, { scope: { kind: 'group', groupId: 'g1' } })
    expect(sheetOf(sheets, 'tableList')!.rows.map((r) => r[2])).toEqual(['MBR_GRD'])
    expect(sheetOf(sheets, 'tableSpec')!.rows.every((r) => r[2] === 'MBR_GRD')).toBe(true)
    expect(sheetOf(sheets, 'words')!.rows).toHaveLength(2)
    expect(sheetOf(sheets, 'domains')!.rows).toHaveLength(1)
  })

  it('그룹 미배정 테이블의 그룹 칸은 빈 문자열이다', () => {
    const m = buildSampleModel()
    const ungrouped: ProjectModel = {
      ...m,
      tables: { ...m.tables, t1: { ...m.tables['t1']!, groupId: null } },
    }
    const s = sheetOf(buildExcelSheets(ungrouped), 'tableList')!
    expect(s.rows.find((r) => r[2] === 'MBR_GRD')![0]).toBe('')
  })

  it('컬럼이 0개인 테이블은 테이블정의서에서 빠지고 테이블 목록에는 남는다', () => {
    const m = buildSampleModel()
    const empty: ProjectModel = {
      ...m,
      tables: {
        ...m.tables,
        t9: {
          id: 't9', logicalName: '빈테이블', physicalName: 'EMPTY', comment: null,
          groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
        },
      },
    }
    const sheets = buildExcelSheets(empty)
    expect(sheetOf(sheets, 'tableList')!.rows.some((r) => r[2] === 'EMPTY')).toBe(true)
    expect(sheetOf(sheets, 'tableSpec')!.rows.some((r) => r[2] === 'EMPTY')).toBe(false)
  })

  it('sheets 옵션으로 일부만 고르되 고정 순서를 유지한다', () => {
    const sheets = buildExcelSheets(buildSampleModel(), { sheets: ['domains', 'tableList'] })
    expect(sheets.map((s) => s.key)).toEqual(['tableList', 'domains'])
  })
})

describe('buildDictTemplateSheets', () => {
  it('사전 3시트의 헤더만 있는 빈 시트를 낸다', () => {
    const sheets = buildDictTemplateSheets()
    expect(sheets.map((s) => s.key)).toEqual(['words', 'terms', 'domains'])
    expect(sheets.map((s) => s.name)).toEqual([
      EXCEL_SHEET_NAME.words, EXCEL_SHEET_NAME.terms, EXCEL_SHEET_NAME.domains,
    ])
    expect(sheets.every((s) => s.rows.length === 0)).toBe(true)
    expect(sheets[0]!.headers).toEqual(['논리명', '약어', '영문명', '설명'])
  })

  it('양식 헤더는 내보내기 헤더와 완전히 같다 (왕복 계약)', () => {
    const exported = buildExcelSheets(buildSampleModel())
    const template = buildDictTemplateSheets()
    for (const t of template) {
      expect(t.headers).toEqual(exported.find((e) => e.key === t.key)!.headers)
    }
  })
})

describe('buildChangeSheet', () => {
  const meta = { baseLabel: 'v1.0', targetLabel: '현재' }

  it('제목 행에 기준·비교 라벨을 담고 헤더가 상수와 같다', () => {
    const m = createEmptyModel()
    const sheet = buildChangeSheet(diffModelsForDisplay(m, m), meta)
    expect(sheet.key).toBe('changes')
    expect(sheet.name).toBe('변경분 정의서')
    expect(sheet.title).toBe('기준: v1.0 · 비교: 현재')
    expect(sheet.headers).toEqual([...CHANGE_HEADERS])
    expect(sheet.rows).toEqual([])
  })

  it('changed는 속성 하나당 한 행을 만든다', () => {
    // 픽스처의 c3는 nullable:false — false→true로 바꿔야 실제 변경이 된다.
    const base = buildSampleModel()
    const target = structuredClone(base)
    target.columns['c3']!.physicalName = 'MBR_NAME'
    target.columns['c3']!.nullable = true
    const sheet = buildChangeSheet(diffModelsForDisplay(base, target), meta)
    expect(sheet.rows).toHaveLength(2)
    // changed 라벨은 target(현재 상태)에서 해석된다 — 물리명이 MBR_NAME으로
    // 바뀌었으므로 라벨도 그 이름을 쓴다(model-diff.ts labelOf, added와 대칭).
    expect(sheet.rows.every((r) => r[0] === '컬럼' && r[1] === 'MBR.MBR_NAME')).toBe(true)
    expect(sheet.rows.every((r) => r[2] === '변경')).toBe(true)
    const physical = sheet.rows.find((r) => r[3] === '물리명')!
    expect(physical[4]).toBe('MBR_NM')
    expect(physical[5]).toBe('MBR_NAME')
  })

  it('added/removed는 한 행이고 속성·값 칸이 빈다', () => {
    const base = buildSampleModel()
    const target = structuredClone(base)
    delete target.columns['c3']
    const sheet = buildChangeSheet(diffModelsForDisplay(base, target), meta)
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0]).toEqual(['컬럼', 'MBR.MBR_NM', '삭제', '', '', ''])
  })
})

describe('물리명 템플릿', () => {
  const TPL: NamingRules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
  function m(): ProjectModel {
    const x = buildSampleModel()
    x.tableGroups['g1'] = { ...x.tableGroups['g1']!, alias: 'MBR' }
    return x
  }

  it('테이블 목록 시트의 물리명 열이 조합 이름이다', () => {
    const s = sheetOf(buildExcelSheetsRaw(m(), { rules: TPL }), 'tableList')!
    const names = s.rows.map((r) => r[2])          // [그룹, 논리명, 물리명, 설명, …]
    expect(names).toContain('TB_MBR_MBR')
    expect(names).not.toContain('MBR')
  })

  it('테이블 정의서 시트의 물리명 열도 조합 이름이다', () => {
    const s = sheetOf(buildExcelSheetsRaw(m(), { rules: TPL }), 'tableSpec')!
    const names = new Set(s.rows.map((r) => r[2]))
    expect(names.has('TB_MBR_MBR')).toBe(true)
    expect(names.has('MBR')).toBe(false)
  })

  it('템플릿이 없으면 지금과 같다', () => {
    const s = sheetOf(buildExcelSheets(m()), 'tableList')!
    expect(s.rows.map((r) => r[2])).toContain('MBR')
  })

  // ⚠️ 행 순서도 조합 기준이다 — 표시되는 물리명 열이 조합 이름인데 정렬만 부분 기준이면
  // 열이 정렬돼 있지 않은 것처럼 보이고, 같은 모델의 DDL 순서와도 갈린다(DDL 정렬을 조합
  // 기준으로 바꾼 근거가 여기에도 그대로 적용된다).
  it('행 순서도 조합 이름 기준이다', () => {
    // 같은 그룹 안에서 접두가 갈리는 템플릿을 쓴다 — 그래야 부분 기준과 조합 기준이 갈린다.
    const x = m()
    x.customFields['cf9'] = {
      id: 'cf9', name: '서브시스템', target: 'table', type: 'text',
      options: [], required: false, defaultValue: null, order: 0, origin: null,
    }
    // 부분 기준: MBR(t2) < MBR_GRD(t1). 조합 기준: AA_MBR_GRD(t1) < ZZ_MBR(t2) 로 뒤집힌다.
    x.tables['t2'] = { ...x.tables['t2']!, custom: { cf9: 'ZZ' } }
    x.tables['t1'] = { ...x.tables['t1']!, custom: { cf9: 'AA' } }
    const rules: NamingRules = {
      ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: '{커스텀:서브시스템}_{물리명}',
    }
    const names = sheetOf(buildExcelSheetsRaw(x, { rules }), 'tableList')!.rows.map((r) => r[2])
    expect(names).toEqual(['AA_MBR_GRD', 'ZZ_MBR'])
  })
})
