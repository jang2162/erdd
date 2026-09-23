import { DICT_SHEET_KEYS, type RawSheet } from './excel-import.js'
import { EXCEL_SHEET_NAME } from './excel-sheets.js'

/** exceljs Workbook 의 쓰는 부분만. core 가 exceljs 에 의존하지 않도록 구조 타입으로 받는다. */
export type WorksheetLike = {
  rowCount: number
  getRow(n: number): { values: unknown; getCell(col: number): { value: unknown } }
}
export type WorkbookLike = { getWorksheet(name: string): WorksheetLike | undefined }

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

/**
 * 워크북에서 사전 3시트(단어사전·용어사전·도메인정의서)를 문자열 격자로 읽는다. 웹(브라우저)과
 * CLI(노드)가 각자 exceljs 로 연 워크북을 넘긴다 — 셀 해석이 두 곳에서 갈라지지 않게 여기 하나다.
 * 그 이름의 시트가 하나도 없으면 던진다 — 잘못된 파일을 조용히 0건으로 처리하지 않기 위해서다.
 */
export function dictSheetsFromWorkbook(wb: WorkbookLike): RawSheet[] {
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
  if (out.length === 0) throw new Error('단어사전·용어사전·도메인정의서 시트를 찾을 수 없습니다')
  return out
}
