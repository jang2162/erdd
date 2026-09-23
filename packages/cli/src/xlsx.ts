import { dictSheetsFromWorkbook, type RawSheet } from '@erdd/core'
import { CliError } from './output.js'

/** 노드에서 .xlsx 를 연다. 셀 해석은 웹과 같은 core `dictSheetsFromWorkbook` 이다. */
export async function readDictSheetsFile(path: string): Promise<RawSheet[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(path)
  } catch (err) {
    throw new CliError('VALIDATION', `Excel 파일을 읽지 못했습니다: ${path} — ${(err as Error).message}`)
  }
  try {
    return dictSheetsFromWorkbook(wb)
  } catch (err) {
    throw new CliError('VALIDATION', `${path}: ${(err as Error).message}`)
  }
}
