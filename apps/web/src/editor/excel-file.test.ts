import { describe, expect, it } from 'vitest'
import type { Domain, ProjectModel, SheetData, Term, Word } from '@erdd/core'
import { DEFAULT_NAMING_RULES, buildExcelSheets, createEmptyModel, planDictImport } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { buildWorkbookBlob, readDictSheets } from './excel-file.js'
import { applyDictImport } from './dict-import-edits.js'

const sheets: SheetData[] = [
  {
    key: 'words', name: '단어사전', headers: ['논리명', '약어', '영문명', '설명'],
    rows: [['회원', 'MBR', 'MEMBER', ''], ['번호', 'NO', '', '순번']],
  },
  {
    key: 'domains', name: '도메인정의서',
    headers: ['이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명'],
    rows: [['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']],
  },
]

describe('excel-file 왕복', () => {
  it('만든 워크북을 다시 읽으면 헤더와 셀 값이 보존된다', async () => {
    const blob = await buildWorkbookBlob(sheets)
    const read = await readDictSheets(blob)
    expect(read.map((s) => s.key)).toEqual(['words', 'domains'])
    expect(read[0]!.headers).toEqual(['논리명', '약어', '영문명', '설명'])
    expect(read[0]!.rows).toEqual([['회원', 'MBR', 'MEMBER', ''], ['번호', 'NO', '', '순번']])
    expect(read[1]!.rows).toEqual([['금액', '', 'DECIMAL(15,2)', '', '', '', '', '', '', '']])
  })

  it('사전이 아닌 시트는 읽기 결과에서 제외된다', async () => {
    const withSpec: SheetData[] = [
      { key: 'tableList', name: '테이블 목록', headers: ['그룹', '논리명'], rows: [['g', '회원']] },
      ...sheets,
    ]
    const read = await readDictSheets(await buildWorkbookBlob(withSpec))
    expect(read.map((s) => s.key)).toEqual(['words', 'domains'])
  })

  it('사전 시트가 하나도 없으면 에러를 던진다', async () => {
    const only: SheetData[] = [
      { key: 'tableList', name: '테이블 목록', headers: ['그룹'], rows: [['g']] },
    ]
    const blob = await buildWorkbookBlob(only)
    await expect(readDictSheets(blob)).rejects.toThrow(/단어사전/)
  })

  it('숫자·불리언 셀은 문자열로 정규화되고 빈 셀은 빈 문자열이 된다', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('단어사전')
    ws.addRow(['논리명', '약어', '영문명', '설명'])
    ws.addRow([1234, true, null, undefined])
    const buf = await wb.xlsx.writeBuffer()
    const read = await readDictSheets(new Blob([buf]))
    expect(read[0]!.rows).toEqual([['1234', 'true', '', '']])
  })

  it('날짜·서식 텍스트·수식 셀도 문자열로 정규화된다', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('단어사전')
    ws.addRow(['논리명', '약어', '영문명', '설명'])
    const row = ws.addRow([])
    row.getCell(1).value = { richText: [{ text: '주' }, { text: '문' }] }   // 일부만 서식이 다른 셀
    row.getCell(2).value = { formula: 'UPPER("ord")', result: 'ORD' }       // 수식 셀은 계산값을 쓴다
    row.getCell(3).value = 'ORDER'
    row.getCell(4).value = new Date(Date.UTC(2026, 6, 28))                  // 날짜 서식 셀
    const read = await readDictSheets(new Blob([await wb.xlsx.writeBuffer()]))
    expect(read[0]!.rows).toEqual([['주문', 'ORD', 'ORDER', '2026-07-28']])
  })

  it('데이터가 없는 시트는 빈 rows를 낸다', async () => {
    const empty: SheetData[] = [
      { key: 'words', name: '단어사전', headers: ['논리명', '약어', '영문명', '설명'], rows: [] },
    ]
    const read = await readDictSheets(await buildWorkbookBlob(empty))
    expect(read[0]!.rows).toEqual([])
    expect(read[0]!.headers).toEqual(['논리명', '약어', '영문명', '설명'])
  })
})

/** 사전 3종이 모두 찬 모델. 내보내기 → 업로드 왕복의 원본으로 쓴다. */
function modelWithDictionaries(): ProjectModel {
  const m = buildSampleModel()
  const domains: Record<string, Domain> = {
    d1: {
      id: 'd1', name: '등급코드', category: '코드', logicalType: 'CHAR(2)',
      dialectTypes: { postgresql: 'char(2)', mysql: null, oracle: null, mssql: null },
      defaultValue: "'01'", allowedValues: ['01', '02'], description: '회원 등급',
    },
  }
  const words: Record<string, Word> = {
    w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null },
    w2: { id: 'w2', logicalName: '번호', abbreviation: 'NO', englishName: null, description: '순번' },
  }
  const terms: Record<string, Term> = {
    tm1: {
      id: 'tm1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: 'd1', description: '회원 식별자',
    },
  }
  return { ...m, domains, words, terms }
}

/**
 * "내보낸 사전 파일을 고쳐서 다시 올릴 수 있다"는 이 기능의 핵심 약속을 한 번에 검증한다.
 * 시트 빌더 → 워크북 → 업로드 파서 → 계획 → 적용까지 전 구간을 실제로 통과시킨다.
 */
describe('내보내기 → 업로드 왕복', () => {
  it('내보낸 워크북을 그대로 다시 올리면 오류 없이 같은 사전으로 복원된다', async () => {
    const source = modelWithDictionaries()
    const blob = await buildWorkbookBlob(buildExcelSheets(source))
    const raw = await readDictSheets(blob)
    expect(raw.map((s) => s.key)).toEqual(['words', 'terms', 'domains'])

    const plan = planDictImport(raw, createEmptyModel(), DEFAULT_NAMING_RULES)
    expect(plan.issues).toEqual([])
    expect(plan.total).toEqual({ created: 4, duplicated: 0, errored: 0 })

    const wordDrafts = plan.entries.flatMap((e) => (e.kind === 'word' ? [e.draft] : []))
    expect(wordDrafts.map((d) => d.logicalName)).toEqual(['번호', '회원'])
    expect(wordDrafts[1]).toEqual({
      logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null,
    })
    const termDrafts = plan.entries.flatMap((e) => (e.kind === 'term' ? [e.draft] : []))
    expect(termDrafts).toEqual([{
      logicalName: '회원번호', physicalName: 'MBR_NO', domainName: '등급코드', description: '회원 식별자',
    }])
    const domainDrafts = plan.entries.flatMap((e) => (e.kind === 'domain' ? [e.draft] : []))
    expect(domainDrafts).toEqual([{
      name: '등급코드', category: '코드', logicalType: 'CHAR(2)',
      dialectTypes: { postgresql: 'char(2)', mysql: null, oracle: null, mssql: null },
      defaultValue: "'01'", allowedValues: ['01', '02'], description: '회원 등급',
    }])

    // 빈 모델에 적용하면 사전 3시트가 원본과 글자 하나까지 같아진다(도메인 참조 포함).
    let n = 0
    const restored = applyDictImport(createEmptyModel(), plan, 'skip', () => `id-${++n}`)
    const dictOnly = { sheets: ['words', 'terms', 'domains'] } as const
    expect(buildExcelSheets(restored, dictOnly)).toEqual(buildExcelSheets(source, dictOnly))
  })
})
