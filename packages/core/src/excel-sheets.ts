import type { Column, ProjectModel, Table } from './model.js'
import type { ExportScope } from './ddl.js'
import { customFieldsFor, resolveCustomValue } from './custom-field.js'
import { decomposeByWords, type NamingRules } from './naming.js'
import { composeTablePhysicalName } from './name-template.js'
import { CHANGE_KIND_LABEL, DIFF_KIND_LABEL, type ModelDiff } from './model-diff.js'

export type ExcelSheetKey = 'tableList' | 'tableSpec' | 'words' | 'terms' | 'domains'

/** 워크북 안에서의 시트 순서. buildExcelSheets는 항상 이 순서로 반환한다. */
export const EXCEL_SHEET_KEYS: readonly ExcelSheetKey[] =
  ['tableList', 'tableSpec', 'words', 'terms', 'domains']

/**
 * 워크북에 실릴 수 있는 전체 시트 키. 'changes'(변경분 정의서)는 내보내기 다이얼로그의
 * 체크박스 목록(EXCEL_SHEET_KEYS)에 넣지 않는다 — 비교 화면에서만 만든다.
 */
export type SheetKey = ExcelSheetKey | 'changes'

export const EXCEL_SHEET_NAME: Record<SheetKey, string> = {
  tableList: '테이블 목록',
  tableSpec: '테이블정의서',
  words: '단어사전',
  terms: '용어사전',
  domains: '도메인정의서',
  changes: '변경분 정의서',
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
export const CHANGE_HEADERS = ['구분', '대상', '변경유형', '속성', '이전값', '이후값'] as const

/**
 * 한 시트의 내용. 모든 셀은 문자열이다 — 물리명 "0001"의 앞 0이 날아가거나
 * 코드값이 숫자로 바뀌는 것을 막고, 업로드 파서와 표현이 대칭이 된다.
 */
export type SheetData = {
  key: SheetKey
  name: string
  headers: string[]
  rows: string[][]
  /** 있으면 헤더 위 1행에 쓰인다(변경분 정의서의 비교 대상 표기). */
  title?: string
}

const text = (v: string | null | undefined): string => v ?? ''

function groupNameOf(model: ProjectModel, t: Table): string {
  return t.groupId ? text(model.tableGroups[t.groupId]?.name) : ''
}

/**
 * 범위에 드는 테이블을 (그룹명, 조합된 물리명) 순으로 낸다.
 * ⚠️ 두 번째 키는 **조합 이름**이다 — 물리명 열에 찍히는 값이 조합 이름이므로 부분으로 정렬하면
 * 열이 정렬돼 있지 않은 것처럼 보이고, 같은 모델의 DDL 순서와도 갈린다(`ddl.ts` 의 `selectTables`
 * 와 같은 근거).
 */
function scopedTables(model: ProjectModel, scope: ExportScope, rules: NamingRules): Table[] {
  const all = Object.values(model.tables)
  let picked: Table[]
  if (scope.kind === 'all') picked = all
  else if (scope.kind === 'group') picked = all.filter((t) => t.groupId === scope.groupId)
  else {
    const ids = new Set(scope.tableIds)
    picked = all.filter((t) => ids.has(t.id))
  }
  const compose = (t: Table) => composeTablePhysicalName(t, model, rules)
  return picked.sort((a, b) =>
    groupNameOf(model, a).localeCompare(groupNameOf(model, b))
    || compose(a).localeCompare(compose(b)))
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
 *
 * rules 는 **테이블 물리명 조합**과 용어 시트의 파생 컬럼 「구성 단어」 분해에 쓴다.
 * ⚠️ 폴백을 두지 마라 — `?? DEFAULT_NAMING_RULES` 는 프로젝트 규칙을 조용히 무시하는 자리였다.
 * 필수 인자라 호출처가 반드시 넘긴다(테스트는 import 별칭 심으로 채운다).
 */
export function buildExcelSheets(
  model: ProjectModel,
  opts: { scope?: ExportScope; sheets?: readonly ExcelSheetKey[]; rules: NamingRules },
): SheetData[] {
  const scope = opts.scope ?? { kind: 'all' }
  const rules = opts.rules
  const wanted = new Set<ExcelSheetKey>(opts.sheets ?? EXCEL_SHEET_KEYS)
  const tables = scopedTables(model, scope, rules)
  const tableFields = customFieldsFor(model, 'table')
  const columnFields = customFieldsFor(model, 'column')

  const build = (key: ExcelSheetKey): SheetData => {
    switch (key) {
      case 'tableList':
        return {
          key, name: EXCEL_SHEET_NAME[key],
          headers: [...TABLE_LIST_HEADERS, ...tableFields.map((f) => f.name)],
          rows: tables.map((t) => [
            groupNameOf(model, t), t.logicalName, composeTablePhysicalName(t, model, rules),
            text(t.comment),
            ...tableFields.map((f) => resolveCustomValue(t, f)),
          ]),
        }
      case 'tableSpec': {
        const rows: string[][] = []
        for (const t of tables) {
          tableColumns(model, t.id).forEach((c, i) => {
            const r = resolveForSheet(model, c)
            rows.push([
              groupNameOf(model, t), t.logicalName, composeTablePhysicalName(t, model, rules),
              String(i + 1),
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
              decomposeByWords(t.logicalName, model.words, rules).map((s) => s.text).join(', '),
              t.physicalName,
              t.domainId ? text(model.domains[t.domainId]?.name) : '',
              text(t.description),
            ]),
        }
      case 'domains':
        // 허용값은 `', '` 조인이고 파서는 `,`로 나눈다. 값 자체에 쉼표가 든 허용값은
        // 왕복하지 못한다(알려진 한계 — 인코딩 변경은 별도 과제).
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

/**
 * 변경분 정의서 한 시트. changed는 속성 하나당 한 행이고, added/removed는
 * 한 행에 속성·값 칸을 비워 둔다(무엇이 통째로 생기거나 사라졌는지가 정보의 전부다).
 */
export function buildChangeSheet(
  diff: ModelDiff, meta: { baseLabel: string; targetLabel: string },
): SheetData {
  const rows: string[][] = []
  for (const e of diff.entries) {
    const head = [DIFF_KIND_LABEL[e.kind], e.label, CHANGE_KIND_LABEL[e.changeKind]]
    if (e.fields.length === 0) {
      rows.push([...head, '', '', ''])
      continue
    }
    for (const f of e.fields) rows.push([...head, f.label, f.before, f.after])
  }
  return {
    key: 'changes',
    name: EXCEL_SHEET_NAME.changes,
    title: `기준: ${meta.baseLabel} · 비교: ${meta.targetLabel}`,
    headers: [...CHANGE_HEADERS],
    rows,
  }
}
