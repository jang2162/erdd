import { dictSheetsFromWorkbook, type RawSheet, type SheetData } from '@erdd/core'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_COLUMN_WIDTH = 60

/**
 * exceljs는 초기 번들에 넣기에 크므로 동적 import로만 불러온다.
 * vitest+jsdom·vite 양쪽에서 네임스페이스에 default만 실리므로 .default를 꺼낸다.
 */
async function loadExcelJs() {
  return (await import('exceljs')).default
}

/** 시트 데이터를 .xlsx 워크북 Blob으로 만든다. */
export async function buildWorkbookBlob(sheets: SheetData[]): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    // title이 있으면 1행은 비교 대상 표기, 헤더는 2행으로 내려간다.
    if (s.title !== undefined) {
      ws.addRow([s.title])
      ws.getRow(1).font = { italic: true }
    }
    const headerRow = s.title === undefined ? 1 : 2
    ws.addRow([...s.headers])
    ws.getRow(headerRow).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: headerRow }]
    if (s.headers.length > 0) {
      ws.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: headerRow, column: s.headers.length },
      }
    }
    for (const row of s.rows) ws.addRow([...row])
    ws.columns.forEach((col, i) => {
      // 제목 행은 열 너비 계산에서 뺀다(제목이 길다고 첫 열이 과하게 넓어지지 않도록).
      const header = s.headers[i] ?? ''
      const longest = s.rows.reduce((max, r) => Math.max(max, (r[i] ?? '').length), header.length)
      col.width = Math.min(MAX_COLUMN_WIDTH, Math.max(10, longest + 2))
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}

/** 워크북을 만들어 브라우저 다운로드를 트리거한다. */
export async function downloadExcelWorkbook(sheets: SheetData[], fileName: string): Promise<void> {
  const blob = await buildWorkbookBlob(sheets)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export async function readDictSheets(file: Blob): Promise<RawSheet[]> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  return dictSheetsFromWorkbook(wb)
}
