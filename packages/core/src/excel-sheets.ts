import type { Column, ProjectModel, Table } from './model.js'
import type { ExportScope } from './ddl.js'
import { customFieldsFor, resolveCustomValue } from './custom-field.js'
import { decomposeByWords } from './naming.js'

export type ExcelSheetKey = 'tableList' | 'tableSpec' | 'words' | 'terms' | 'domains'

/** 워크북 안에서의 시트 순서. buildExcelSheets는 항상 이 순서로 반환한다. */
export const EXCEL_SHEET_KEYS: readonly ExcelSheetKey[] =
  ['tableList', 'tableSpec', 'words', 'terms', 'domains']

export const EXCEL_SHEET_NAME: Record<ExcelSheetKey, string> = {
  tableList: '테이블 목록',
  tableSpec: '테이블정의서',
  words: '단어사전',
  terms: '용어사전',
  domains: '도메인정의서',
}

export const TABLE_LIST_HEADERS = ['그룹', '논리명', '물리명', '설명'] as const
export const TABLE_SPEC_HEADERS = [
  '그룹', '테이블 논리명', '테이블 물리명', '순번', '논리명', '물리명',
  '도메인', '타입', 'PK', 'NOT NULL', '기본값', '설명',
] as const
export const WORD_HEADERS = ['논리명', '약어', '영문명', '설명'] as const
export const TERM_HEADERS = ['용어', '구성 단어', '물리명', '기본 도메인', '설명'] as const
export const DOMAIN_HEADERS = [
  '이름', '분류', '논리 타입', 'PostgreSQL', 'MySQL', 'Oracle', 'MSSQL', '기본값', '허용값', '설명',
] as const

/**
 * 한 시트의 내용. 모든 셀은 문자열이다 — 물리명 "0001"의 앞 0이 날아가거나
 * 코드값이 숫자로 바뀌는 것을 막고, 업로드 파서와 표현이 대칭이 된다.
 */
export type SheetData = { key: ExcelSheetKey; name: string; headers: string[]; rows: string[][] }

const text = (v: string | null | undefined): string => v ?? ''

function groupNameOf(model: ProjectModel, t: Table): string {
  return t.groupId ? text(model.tableGroups[t.groupId]?.name) : ''
}

/** 범위에 드는 테이블을 (그룹명, 물리명) 순으로 낸다. */
function scopedTables(model: ProjectModel, scope: ExportScope): Table[] {
  const all = Object.values(model.tables)
  let picked: Table[]
  if (scope.kind === 'all') picked = all
  else if (scope.kind === 'group') picked = all.filter((t) => t.groupId === scope.groupId)
  else {
    const ids = new Set(scope.tableIds)
    picked = all.filter((t) => ids.has(t.id))
  }
  return picked.sort((a, b) =>
    groupNameOf(model, a).localeCompare(groupNameOf(model, b))
    || a.physicalName.localeCompare(b.physicalName))
}

function tableColumns(model: ProjectModel, tableId: string): Column[] {
  return Object.values(model.columns)
    .filter((c) => c.tableId === tableId)
    .sort((a, b) => a.order - b.order)
}

/**
 * 컬럼의 도메인 이름·논리 타입·기본값을 해석한다(방언 무관 — domain-resolve의
 * resolveColumn과 같은 우선순위지만 SQL 타입을 만들지 않으므로 dialect가 필요 없다).
 */
function resolveForSheet(
  model: ProjectModel, col: Column,
): { domainName: string; type: string; defaultValue: string } {
  const d = col.domainId ? model.domains[col.domainId] : undefined
  if (!d) return { domainName: '', type: col.type, defaultValue: text(col.defaultValue) }
  const own = col.defaultValue !== null && col.defaultValue !== '' ? col.defaultValue : null
  return { domainName: d.name, type: d.logicalType, defaultValue: own ?? text(d.defaultValue) }
}

/**
 * 프로젝트 모델을 Excel 시트 데이터로 만든다.
 * scope는 테이블 시트(tableList/tableSpec)에만 적용된다 — 사전 3종은 그룹 개념이
 * 없는 프로젝트 전역 자산이라 항상 전체를 낸다.
 */
export function buildExcelSheets(
  model: ProjectModel,
  opts: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[] } = {},
): SheetData[] {
  const scope = opts.scope ?? { kind: 'all' }
  const wanted = new Set<ExcelSheetKey>(opts.sheets ?? EXCEL_SHEET_KEYS)
  const tables = scopedTables(model, scope)
  const tableFields = customFieldsFor(model, 'table')
  const columnFields = customFieldsFor(model, 'column')

  const build = (key: ExcelSheetKey): SheetData => {
    switch (key) {
      case 'tableList':
        return {
          key, name: EXCEL_SHEET_NAME[key],
          headers: [...TABLE_LIST_HEADERS, ...tableFields.map((f) => f.name)],
          rows: tables.map((t) => [
            groupNameOf(model, t), t.logicalName, t.physicalName, text(t.comment),
            ...tableFields.map((f) => resolveCustomValue(t, f)),
          ]),
        }
      case 'tableSpec': {
        const rows: string[][] = []
        for (const t of tables) {
          tableColumns(model, t.id).forEach((c, i) => {
            const r = resolveForSheet(model, c)
            rows.push([
              groupNameOf(model, t), t.logicalName, t.physicalName, String(i + 1),
              c.logicalName, c.physicalName, r.domainName, r.type,
              c.isPk ? 'Y' : '', c.nullable ? '' : 'Y', r.defaultValue, text(c.comment),
              ...columnFields.map((f) => resolveCustomValue(c, f)),
            ])
          })
        }
        return {
          key, name: EXCEL_SHEET_NAME[key],
          headers: [...TABLE_SPEC_HEADERS, ...columnFields.map((f) => f.name)],
          rows,
        }
      }
      case 'words':
        return {
          key, name: EXCEL_SHEET_NAME[key], headers: [...WORD_HEADERS],
          rows: Object.values(model.words)
            .sort((a, b) => a.logicalName.localeCompare(b.logicalName))
            .map((w) => [w.logicalName, w.abbreviation, text(w.englishName), text(w.description)]),
        }
      case 'terms':
        return {
          key, name: EXCEL_SHEET_NAME[key], headers: [...TERM_HEADERS],
          rows: Object.values(model.terms)
            .sort((a, b) => a.logicalName.localeCompare(b.logicalName))
            .map((t) => [
              t.logicalName,
              decomposeByWords(t.logicalName, model.words).map((s) => s.text).join(', '),
              t.physicalName,
              t.domainId ? text(model.domains[t.domainId]?.name) : '',
              text(t.description),
            ]),
        }
      case 'domains':
        return {
          key, name: EXCEL_SHEET_NAME[key], headers: [...DOMAIN_HEADERS],
          rows: Object.values(model.domains)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((d) => [
              d.name, text(d.category), d.logicalType,
              text(d.dialectTypes.postgresql), text(d.dialectTypes.mysql),
              text(d.dialectTypes.oracle), text(d.dialectTypes.mssql),
              text(d.defaultValue), d.allowedValues.join(', '), text(d.description),
            ]),
        }
    }
  }

  return EXCEL_SHEET_KEYS.filter((k) => wanted.has(k)).map(build)
}

/** 사전 업로드 양식(단어·용어·도메인 3시트, 헤더만). 내보내기와 같은 헤더를 쓴다. */
export function buildDictTemplateSheets(): SheetData[] {
  return [
    { key: 'words', name: EXCEL_SHEET_NAME.words, headers: [...WORD_HEADERS], rows: [] },
    { key: 'terms', name: EXCEL_SHEET_NAME.terms, headers: [...TERM_HEADERS], rows: [] },
    { key: 'domains', name: EXCEL_SHEET_NAME.domains, headers: [...DOMAIN_HEADERS], rows: [] },
  ]
}
