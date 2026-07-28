import { describe, expect, it } from 'vitest'
import { buildSampleModel } from './testing/fixtures.js'
import type { ProjectModel } from './model.js'
import { buildDictTemplateSheets, buildExcelSheets, EXCEL_SHEET_NAME } from './excel-sheets.js'

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
        defaultValue: "'01'", allowedValues: ['01', '02'], description: '회원 등급',
      },
    },
    words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null },
      w2: { id: 'w2', logicalName: '번호', abbreviation: 'NO', englishName: null, description: '순번' },
    },
    terms: {
      tm1: {
        id: 'tm1', logicalName: '회원번호', physicalName: 'MBR_NO',
        domainId: 'd1', description: '회원 식별자',
      },
    },
    customFields: {
      cf1: {
        id: 'cf1', name: '업무구분', target: 'table', type: 'text',
        options: [], required: false, defaultValue: '공통', order: 0,
      },
      cf2: {
        id: 'cf2', name: '개인정보여부', target: 'column', type: 'select',
        options: ['Y', 'N'], required: false, defaultValue: 'N', order: 0,
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
