import { describe, expect, it } from 'vitest'
import type { SheetData } from '@erdd/core'
import { buildWorkbookBlob, readDictSheets } from './excel-file.js'

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

  it('데이터가 없는 시트는 빈 rows를 낸다', async () => {
    const empty: SheetData[] = [
      { key: 'words', name: '단어사전', headers: ['논리명', '약어', '영문명', '설명'], rows: [] },
    ]
    const read = await readDictSheets(await buildWorkbookBlob(empty))
    expect(read[0]!.rows).toEqual([])
    expect(read[0]!.headers).toEqual(['논리명', '약어', '영문명', '설명'])
  })
})
