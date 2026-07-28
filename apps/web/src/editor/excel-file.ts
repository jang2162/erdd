import {
  EXCEL_SHEET_NAME, type DictSheetKey, type RawSheet, type SheetData,
} from '@erdd/core'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DICT_SHEET_KEYS: readonly DictSheetKey[] = ['words', 'terms', 'domains']
const MAX_COLUMN_WIDTH = 60

/**
 * exceljs는 초기 번들에 넣기에 크므로 동적 import로만 불러온다.
 * vitest+jsdom·vite 양쪽에서 네임스페이스에 default만 실리므로 .default를 꺼낸다.
 */
async function loadExcelJs() {
  return (await import('exceljs')).default
}

/** exceljs Row.values는 1-based 희소 배열(0번은 null)이다. 키 매핑 형태면 빈 배열로 본다. */
function rowValues(row: { values: unknown }): unknown[] {
  return Array.isArray(row.values) ? (row.values as unknown[]) : []
}

/** 셀 값을 문자열로 정규화한다. 파서가 trim을 하므로 여기서는 하지 않는다. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { richText?: { text?: string }[]; result?: unknown; text?: string }
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text ?? '').join('')
    if ('result' in o) return cellText(o.result)
    if (typeof o.text === 'string') return o.text
  }
  return String(v)
}

/** 시트 데이터를 .xlsx 워크북 Blob으로 만든다. */
export async function buildWorkbookBlob(sheets: SheetData[]): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    ws.addRow([...s.headers])
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    if (s.headers.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.headers.length } }
    }
    for (const row of s.rows) ws.addRow([...row])
    ws.columns.forEach((col, i) => {
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

/**
 * 업로드된 워크북에서 사전 3시트(단어사전·용어사전·도메인정의서)를 문자열 격자로 읽는다.
 * 그 이름의 시트가 하나도 없으면 던진다 — 잘못된 파일을 조용히 0건으로 처리하지 않기 위해서다.
 */
export async function readDictSheets(file: Blob): Promise<RawSheet[]> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())

  const out: RawSheet[] = []
  for (const key of DICT_SHEET_KEYS) {
    const ws = wb.getWorksheet(EXCEL_SHEET_NAME[key])
    if (!ws) continue
    const headerValues = rowValues(ws.getRow(1))
    const headers: string[] = []
    for (let c = 1; c < headerValues.length; c++) headers.push(cellText(headerValues[c]))
    while (headers.length > 0 && headers.at(-1) === '') headers.pop()
    if (headers.length === 0) continue

    const rows: string[][] = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const values = headers.map((_, i) => cellText(row.getCell(i + 1).value))
      if (values.every((v) => v.trim() === '')) continue
      rows.push(values)
    }
    out.push({ key, headers, rows })
  }

  if (out.length === 0) {
    throw new Error('단어사전·용어사전·도메인정의서 시트를 찾을 수 없습니다')
  }
  return out
}
