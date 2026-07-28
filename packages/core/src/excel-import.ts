import type { Domain, ProjectModel, Term, Word } from './model.js'
import type { NamingRules } from './naming.js'
import { generatePhysicalName } from './naming.js'
import { DOMAIN_HEADERS, TERM_HEADERS, WORD_HEADERS } from './excel-sheets.js'

export type DictSheetKey = 'words' | 'terms' | 'domains'

/** 워크시트 한 장을 문자열 격자로 옮긴 것. 헤더 1행 + 데이터 행들. */
export type RawSheet = { key: DictSheetKey; headers: string[]; rows: string[][] }

/** row는 1-based 데이터 행 번호(엑셀 행 번호 = row + 1). 시트 전체 문제면 null. */
export type DictImportIssue = {
  sheet: DictSheetKey
  row: number | null
  level: 'error' | 'warning'    // error=행 스킵, warning=행 등록하되 일부 값 무시
  message: string
}

/** 기본 도메인은 이름으로만 담는다 — id 해석은 도메인을 반영한 뒤 적용 단계에서 한다. */
export type TermDraft = Omit<Term, 'id' | 'domainId'> & { domainName: string }

export type DictImportEntry =
  | { kind: 'word'; row: number; draft: Omit<Word, 'id'>; existingId: string | null }
  | { kind: 'term'; row: number; draft: TermDraft; existingId: string | null }
  | { kind: 'domain'; row: number; draft: Omit<Domain, 'id'>; existingId: string | null }

export type DictImportCounts = { created: number; duplicated: number; errored: number }

export type DictImportPlan = {
  entries: DictImportEntry[]
  issues: DictImportIssue[]
  total: DictImportCounts
  bySheet: Record<DictSheetKey, DictImportCounts>
}

const KEY_HEADER: Record<DictSheetKey, string> = {
  words: WORD_HEADERS[0],      // '논리명'
  terms: TERM_HEADERS[0],      // '용어'
  domains: DOMAIN_HEADERS[0],  // '이름'
}

const SHEET_OF: Record<DictImportEntry['kind'], DictSheetKey> = {
  word: 'words', term: 'terms', domain: 'domains',
}

function columnIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => (h ?? '').trim() === name)
}
function cell(row: string[], idx: number): string {
  return idx < 0 ? '' : (row[idx] ?? '').trim()
}
const orNull = (s: string): string | null => (s === '' ? null : s)
const isBlank = (row: string[]): boolean => row.every((c) => (c ?? '').trim() === '')
const splitList = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter((x) => x !== '')

/**
 * 사전 시트를 파싱해 적용 계획을 세운다. 모델은 바꾸지 않는다 — 미리보기를 그린 뒤
 * 사용자가 건너뛰기/덮어쓰기를 고르고 나서 applyDictImport(web)가 실제로 반영한다.
 *
 * 처리 순서는 도메인 → 단어 → 용어다. 용어의 "기본 도메인"을 검증할 때 이번 파일에서
 * 새로 생기는 도메인 이름도 알아야 하기 때문이다.
 *
 * rules를 주면 용어의 물리명이 비었을 때 단어 사전으로 자동 생성한다. 이때 terms에는
 * 빈 객체를 넘긴다 — 자기 자신에 완전일치해 단축되는 것을 막고 단어 분해만 쓰기 위해서다.
 */
export function planDictImport(
  sheets: RawSheet[], model: ProjectModel, rules?: NamingRules,
): DictImportPlan {
  const entries: DictImportEntry[] = []
  const issues: DictImportIssue[] = []
  const domainNames = new Set(Object.values(model.domains).map((d) => d.name.trim()))

  /** 키 헤더를 확인하고 유효한 데이터 행을 순회한다. 없으면 시트 이슈를 남기고 만다. */
  const eachRow = (
    key: DictSheetKey,
    onRow: (row: string[], rowNo: number, headers: string[], keyValue: string) => void,
  ): void => {
    const sheet = sheets.find((s) => s.key === key)
    if (!sheet) return
    const keyName = KEY_HEADER[key]
    const keyIdx = columnIndex(sheet.headers, keyName)
    if (keyIdx < 0) {
      issues.push({
        sheet: key, row: null, level: 'error',
        message: `"${keyName}" 헤더를 찾을 수 없어 시트를 건너뜁니다`,
      })
      return
    }
    const seen = new Map<string, number>()
    sheet.rows.forEach((row, i) => {
      const rowNo = i + 1
      if (isBlank(row)) return
      const keyValue = cell(row, keyIdx)
      if (keyValue === '') {
        issues.push({ sheet: key, row: rowNo, level: 'error', message: `${keyName}이 비어 있습니다` })
        return
      }
      const prev = seen.get(keyValue)
      if (prev !== undefined) {
        issues.push({
          sheet: key, row: rowNo, level: 'error',
          message: `${prev}행과 ${keyName}이(가) 중복됩니다`,
        })
        return
      }
      seen.set(keyValue, rowNo)
      onRow(row, rowNo, sheet.headers, keyValue)
    })
  }

  // 1) 도메인 — 용어가 참조할 수 있도록 먼저 처리한다
  eachRow('domains', (row, rowNo, headers, name) => {
    const logicalType = cell(row, columnIndex(headers, '논리 타입'))
    if (logicalType === '') {
      issues.push({ sheet: 'domains', row: rowNo, level: 'error', message: '논리 타입이 비어 있습니다' })
      return
    }
    const existing = Object.values(model.domains).find((d) => d.name.trim() === name)
    entries.push({
      kind: 'domain', row: rowNo, existingId: existing?.id ?? null,
      draft: {
        name,
        category: orNull(cell(row, columnIndex(headers, '분류'))),
        logicalType,
        dialectTypes: {
          postgresql: orNull(cell(row, columnIndex(headers, 'PostgreSQL'))),
          mysql: orNull(cell(row, columnIndex(headers, 'MySQL'))),
          oracle: orNull(cell(row, columnIndex(headers, 'Oracle'))),
          mssql: orNull(cell(row, columnIndex(headers, 'MSSQL'))),
        },
        defaultValue: orNull(cell(row, columnIndex(headers, '기본값'))),
        allowedValues: splitList(cell(row, columnIndex(headers, '허용값'))),
        description: orNull(cell(row, columnIndex(headers, '설명'))),
      },
    })
    domainNames.add(name)
  })

  // 2) 단어
  eachRow('words', (row, rowNo, headers, logicalName) => {
    const existing = Object.values(model.words).find((w) => w.logicalName.trim() === logicalName)
    entries.push({
      kind: 'word', row: rowNo, existingId: existing?.id ?? null,
      draft: {
        logicalName,
        abbreviation: cell(row, columnIndex(headers, '약어')),
        englishName: orNull(cell(row, columnIndex(headers, '영문명'))),
        description: orNull(cell(row, columnIndex(headers, '설명'))),
      },
    })
  })

  // 3) 용어 — "구성 단어" 컬럼은 파생값이라 읽지 않는다
  eachRow('terms', (row, rowNo, headers, logicalName) => {
    let physicalName = cell(row, columnIndex(headers, '물리명'))
    if (physicalName === '' && rules) {
      physicalName = generatePhysicalName(logicalName, model.words, {}, rules).physicalName
    }
    if (physicalName === '') {
      issues.push({
        sheet: 'terms', row: rowNo, level: 'error',
        message: '물리명이 비어 있고 단어 사전으로 자동 생성할 수도 없습니다',
      })
      return
    }
    const domainName = cell(row, columnIndex(headers, '기본 도메인'))
    if (domainName !== '' && !domainNames.has(domainName)) {
      issues.push({
        sheet: 'terms', row: rowNo, level: 'warning',
        message: `기본 도메인 "${domainName}"을(를) 찾을 수 없어 비웁니다`,
      })
    }
    const existing = Object.values(model.terms).find((t) => t.logicalName.trim() === logicalName)
    entries.push({
      kind: 'term', row: rowNo, existingId: existing?.id ?? null,
      draft: {
        logicalName, physicalName, domainName,
        description: orNull(cell(row, columnIndex(headers, '설명'))),
      },
    })
  })

  const countsFor = (key: DictSheetKey): DictImportCounts => {
    const mine = entries.filter((e) => SHEET_OF[e.kind] === key)
    return {
      created: mine.filter((e) => e.existingId === null).length,
      duplicated: mine.filter((e) => e.existingId !== null).length,
      errored: issues.filter((i) => i.sheet === key && i.level === 'error').length,
    }
  }
  const bySheet: Record<DictSheetKey, DictImportCounts> = {
    words: countsFor('words'), terms: countsFor('terms'), domains: countsFor('domains'),
  }
  const total: DictImportCounts = {
    created: bySheet.words.created + bySheet.terms.created + bySheet.domains.created,
    duplicated: bySheet.words.duplicated + bySheet.terms.duplicated + bySheet.domains.duplicated,
    errored: bySheet.words.errored + bySheet.terms.errored + bySheet.domains.errored,
  }
  return { entries, issues, total, bySheet }
}
