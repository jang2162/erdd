import { describe, expect, it } from 'vitest'
import { dictSheetsFromWorkbook, type WorkbookLike } from './excel-workbook.js'

function workbook(sheets: Record<string, unknown[][]>): WorkbookLike {
  return {
    getWorksheet: (name) => {
      const rows = sheets[name]
      if (rows === undefined) return undefined
      return {
        rowCount: rows.length,
        getRow: (n) => ({
          values: [null, ...(rows[n - 1] ?? [])],
          getCell: (col) => ({ value: rows[n - 1]?.[col - 1] ?? null }),
        }),
      }
    },
  }
}

describe('dictSheetsFromWorkbook', () => {
  it('사전 시트를 문자열 격자로 읽고 빈 행을 건너뛴다', () => {
    const sheets = dictSheetsFromWorkbook(workbook({
      단어사전: [['논리명', '약어'], ['고객', 'CUST'], [null, ''], [{ richText: [{ text: '주' }, { text: '문' }] }, { result: 'ORD' }]],
    }))
    expect(sheets).toEqual([{ key: 'words', headers: ['논리명', '약어'], rows: [['고객', 'CUST'], ['주문', 'ORD']] }])
  })

  it('사전 시트가 하나도 없으면 던진다', () => {
    expect(() => dictSheetsFromWorkbook(workbook({ 다른시트: [['a']] }))).toThrow(/단어사전/)
  })
})
