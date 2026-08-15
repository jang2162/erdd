import type { Domain, ProjectModel, Term, Word } from './model.js'
import type { NamingRules } from './naming.js'
import { decomposeByWords, generatePhysicalName } from './naming.js'
import { DOMAIN_HEADERS, TERM_HEADERS, WORD_HEADERS } from './excel-sheets.js'

export type DictSheetKey = 'words' | 'terms' | 'domains'

/** 사전 시트의 고정 순서. 파일에서 읽을 때도 미리보기에 늘어놓을 때도 이 순서를 쓴다. */
export const DICT_SHEET_KEYS: readonly DictSheetKey[] = ['words', 'terms', 'domains']

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

/**
 * 덮어쓰기용 부분 갱신값 — 시트 헤더에 실제로 있던 컬럼만 담는다.
 * 컬럼이 아예 없는 것과 셀이 비어 있는 것은 다른 의사표시다. 없는 컬럼까지 draft로
 * 덮으면 영문명 컬럼이 빠진 파일 한 장이 기존 영문명을 전부 지워 버린다.
 */
export type WordPatch = Partial<Omit<Word, 'id'>>
export type TermPatch = Partial<TermDraft>
export type DomainPatch =
  Partial<Omit<Domain, 'id' | 'dialectTypes'>> & { dialectTypes?: Partial<Domain['dialectTypes']> }

/**
 * draft는 신규 생성용 완전값(없던 컬럼은 빈 값/null 기본값), patch는 덮어쓰기용 부분값이다.
 * draft = 기본값 + patch 이므로 두 값이 어긋날 일은 없다.
 */
export type DictImportEntry =
  | { kind: 'word'; row: number; draft: Omit<Word, 'id'>; patch: WordPatch; existingId: string | null }
  | { kind: 'term'; row: number; draft: TermDraft; patch: TermPatch; existingId: string | null }
  | { kind: 'domain'; row: number; draft: Omit<Domain, 'id'>; patch: DomainPatch; existingId: string | null }

export type DictImportCounts = { created: number; duplicated: number; errored: number }

export type DictImportPlan = {
  entries: DictImportEntry[]
  issues: DictImportIssue[]
  total: DictImportCounts
  bySheet: Record<DictSheetKey, DictImportCounts>
  /** 시트별로 헤더 행에서 알아본 컬럼 이름(정해진 순서). 덮어쓰기가 건드리는 범위와 같다. */
  recognizedColumns: Record<DictSheetKey, string[]>
}

const KEY_HEADER: Record<DictSheetKey, string> = {
  words: WORD_HEADERS[0],      // '논리명'
  terms: TERM_HEADERS[0],      // '용어'
  domains: DOMAIN_HEADERS[0],  // '이름'
}

/** 파서가 실제로 읽는 컬럼. '구성 단어'는 파생값이라 읽지 않으므로 뺀다. */
const PARSED_HEADERS: Record<DictSheetKey, readonly string[]> = {
  words: WORD_HEADERS,
  terms: TERM_HEADERS.filter((h) => h !== '구성 단어'),
  domains: DOMAIN_HEADERS,
}

const SHEET_OF: Record<DictImportEntry['kind'], DictSheetKey> = {
  word: 'words', term: 'terms', domain: 'domains',
}

/** 한 데이터 행을 시트 헤더에 비추어 읽는 창구. */
type RowReader = {
  /** 그 이름의 컬럼이 헤더에 있었는가(= 덮어쓰기 대상인가). */
  has: (name: string) => boolean
  /** 셀 값(trim). 컬럼이 없으면 빈 문자열. */
  at: (name: string) => string
}

function cell(row: string[], idx: number): string {
  return idx < 0 ? '' : (row[idx] ?? '').trim()
}
const orNull = (s: string): string | null => (s === '' ? null : s)
const isBlank = (row: string[]): boolean => row.every((c) => (c ?? '').trim() === '')
/**
 * 허용값을 쉼표로 나눈다. 내보내기는 `', '`로 조인하므로 값 자체에 쉼표가 든 허용값은
 * 왕복하지 못한다(알려진 한계 — 인코딩 변경은 별도 과제).
 */
const splitList = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter((x) => x !== '')

/** 받침이 있으면 true. 한글 음절이 아니면 있는 쪽(이/을)으로 본다. */
function hasFinalConsonant(word: string): boolean {
  const last = word.at(-1)
  if (last === undefined) return true
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return true
  return (code - 0xac00) % 28 !== 0
}
/** 주격 조사 이/가. */
const subjectParticle = (word: string): string => (hasFinalConsonant(word) ? '이' : '가')
/** 목적격 조사 을/를. */
const objectParticle = (word: string): string => (hasFinalConsonant(word) ? '을' : '를')

/** 이름 → id 조회표. 행마다 Object.values().find()를 도는 O(행×사전)을 없앤다. */
function idByName<T extends { id: string }>(
  items: Record<string, T>, nameOf: (item: T) => string,
): Map<string, string> {
  const m = new Map<string, string>()
  for (const item of Object.values(items)) {
    const name = nameOf(item).trim()
    if (!m.has(name)) m.set(name, item.id)
  }
  return m
}

/**
 * 사전 시트를 파싱해 적용 계획을 세운다. 모델은 바꾸지 않는다 — 미리보기를 그린 뒤
 * 사용자가 건너뛰기/덮어쓰기를 고르고 나서 applyDictImport(web)가 실제로 반영한다.
 *
 * 처리 순서는 도메인 → 단어 → 용어다. 용어의 "기본 도메인"을 검증할 때 이번 파일에서
 * 새로 생기는 도메인 이름도 알아야 하고, 용어 물리명을 자동 생성할 때 이번 파일에서
 * 새로 생기는 단어의 약어도 써야 하기 때문이다.
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
  const domainIdByName = idByName(model.domains, (d) => d.name)
  const wordIdByName = idByName(model.words, (w) => w.logicalName)
  const termIdByName = idByName(model.terms, (t) => t.logicalName)
  const recognizedColumns: Record<DictSheetKey, string[]> = { words: [], terms: [], domains: [] }

  /** 키 헤더를 확인하고 유효한 데이터 행을 순회한다. 없으면 시트 이슈를 남기고 만다. */
  const eachRow = (
    key: DictSheetKey,
    onRow: (r: RowReader, rowNo: number, keyValue: string) => void,
  ): void => {
    const sheet = sheets.find((s) => s.key === key)
    if (!sheet) return
    // 헤더→인덱스는 시트당 한 번만 만든다(셀마다 헤더 배열을 다시 훑지 않는다). 같은 이름이
    // 두 번 나오면 앞의 것을 쓴다.
    const indexByHeader = new Map<string, number>()
    sheet.headers.forEach((h, i) => {
      const name = (h ?? '').trim()
      if (name !== '' && !indexByHeader.has(name)) indexByHeader.set(name, i)
    })
    const keyName = KEY_HEADER[key]
    const keyIdx = indexByHeader.get(keyName) ?? -1
    if (keyIdx < 0) {
      issues.push({
        sheet: key, row: null, level: 'error',
        message: `"${keyName}" 헤더를 찾을 수 없어 시트를 건너뜁니다`,
      })
      return
    }
    const recognized = PARSED_HEADERS[key].filter((h) => indexByHeader.has(h))
    recognizedColumns[key] = recognized
    const recognizedSet = new Set(recognized)

    const seen = new Map<string, number>()
    sheet.rows.forEach((row, i) => {
      const rowNo = i + 1
      if (isBlank(row)) return
      const keyValue = cell(row, keyIdx)
      if (keyValue === '') {
        issues.push({
          sheet: key, row: rowNo, level: 'error',
          message: `${keyName}${subjectParticle(keyName)} 비어 있습니다`,
        })
        return
      }
      const prev = seen.get(keyValue)
      if (prev !== undefined) {
        issues.push({
          sheet: key, row: rowNo, level: 'error',
          message: `${keyName}${subjectParticle(keyName)} ${prev}행과 중복됩니다`,
        })
        return
      }
      seen.set(keyValue, rowNo)
      onRow({
        has: (name) => recognizedSet.has(name),
        at: (name) => cell(row, indexByHeader.get(name) ?? -1),
      }, rowNo, keyValue)
    })
  }

  // 1) 도메인 — 용어가 참조할 수 있도록 먼저 처리한다
  eachRow('domains', (r, rowNo, name) => {
    const logicalType = r.at('논리 타입')
    if (logicalType === '') {
      issues.push({ sheet: 'domains', row: rowNo, level: 'error', message: '논리 타입이 비어 있습니다' })
      return
    }
    const dialectPatch: Partial<Domain['dialectTypes']> = {}
    if (r.has('PostgreSQL')) dialectPatch.postgresql = orNull(r.at('PostgreSQL'))
    if (r.has('MySQL')) dialectPatch.mysql = orNull(r.at('MySQL'))
    if (r.has('Oracle')) dialectPatch.oracle = orNull(r.at('Oracle'))
    if (r.has('MSSQL')) dialectPatch.mssql = orNull(r.at('MSSQL'))

    const patch: DomainPatch = { name, logicalType }
    if (r.has('분류')) patch.category = orNull(r.at('분류'))
    if (Object.keys(dialectPatch).length > 0) patch.dialectTypes = dialectPatch
    if (r.has('기본값')) patch.defaultValue = orNull(r.at('기본값'))
    if (r.has('허용값')) patch.allowedValues = splitList(r.at('허용값'))
    if (r.has('설명')) patch.description = orNull(r.at('설명'))

    const draft: Omit<Domain, 'id'> = {
      name, category: null, logicalType,
      defaultValue: null, allowedValues: [], description: null,
      ...patch,
      // patch.dialectTypes는 부분값이라 그대로 쓸 수 없다. 기본값 null 위에 다시 얹는다.
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null, ...dialectPatch },
      // Excel 시트에는 origin 컬럼이 없다. 가져온 항목은 공용 리소스 원본과 무관한 신규 항목이다.
      origin: null,
    }
    entries.push({ kind: 'domain', row: rowNo, existingId: domainIdByName.get(name) ?? null, draft, patch })
    domainNames.add(name)
  })

  // 2) 단어 — 용어 물리명 자동 생성에 쓰이므로 용어보다 먼저 처리한다
  eachRow('words', (r, rowNo, logicalName) => {
    const patch: WordPatch = { logicalName }
    if (r.has('약어')) patch.abbreviation = r.at('약어')
    if (r.has('영문명')) patch.englishName = orNull(r.at('영문명'))
    if (r.has('설명')) patch.description = orNull(r.at('설명'))
    const draft: Omit<Word, 'id'> = {
      logicalName, abbreviation: '', englishName: null, description: null, ...patch,
      origin: null,
    }
    entries.push({ kind: 'word', row: rowNo, existingId: wordIdByName.get(logicalName) ?? null, draft, patch })
  })

  // 이번 파일의 단어를 기존 사전 위에 얹은 "적용 후" 단어 사전. 논리명이 겹치면 파일 쪽이
  // 이긴다 — 방금 등록하겠다고 올린 값이 사용자의 최신 의사이기 때문이다.
  // (generatePhysicalName은 logicalName/abbreviation만 읽으므로 id는 아무 값이어도 된다.)
  const effectiveWords: Record<string, Word> = { ...model.words }
  for (const e of entries) {
    if (e.kind !== 'word') continue
    const id = e.existingId ?? `import:${e.row}`
    effectiveWords[id] = { ...e.draft, id }
  }

  // 3) 용어 — "구성 단어" 컬럼은 파생값이라 읽지 않는다
  eachRow('terms', (r, rowNo, logicalName) => {
    const hasPhysicalColumn = r.has('물리명')
    let physicalName = r.at('물리명')
    if (physicalName === '' && rules) {
      physicalName = generatePhysicalName(logicalName, effectiveWords, {}, rules).physicalName
      // 약어가 빈 단어는 단어 시트에서는 허용되지만(관대한 파싱), 그 단어로 물리명을 만들면
      // 그 자리가 빈 채로 이어붙어 "회원번호 → _NO" 같은 값이 나온다. 행은 그대로 등록하되
      // 어느 단어 때문인지 알려 준다.
      if (physicalName !== '') {
        const blanks = [...new Set(
          decomposeByWords(logicalName, effectiveWords, rules)
            .flatMap((s) => (s.word !== null && s.word.abbreviation.trim() === '' ? [s.word.logicalName] : [])),
        )]
        if (blanks.length > 0) {
          issues.push({
            sheet: 'terms', row: rowNo, level: 'warning',
            message: `물리명 자동 생성에 약어가 비어 있는 단어를 썼습니다: ${blanks.join(', ')}`,
          })
        }
      }
    }
    if (physicalName === '') {
      issues.push({
        sheet: 'terms', row: rowNo, level: 'error',
        message: '물리명이 비어 있고 단어 사전으로 자동 생성할 수도 없습니다',
      })
      return
    }
    const domainName = r.at('기본 도메인')
    if (domainName !== '' && !domainNames.has(domainName)) {
      issues.push({
        sheet: 'terms', row: rowNo, level: 'warning',
        message: `기본 도메인 "${domainName}"${objectParticle(domainName)} 찾을 수 없어 비웁니다`,
      })
    }
    const patch: TermPatch = { logicalName }
    // 물리명 컬럼이 없으면 자동 생성값으로 기존 물리명을 갈아엎지 않는다(신규 등록에만 쓴다).
    if (hasPhysicalColumn) patch.physicalName = physicalName
    if (r.has('기본 도메인')) patch.domainName = domainName
    if (r.has('설명')) patch.description = orNull(r.at('설명'))
    const draft: TermDraft = {
      logicalName, domainName: '', description: null, ...patch, physicalName, origin: null,
    }
    entries.push({ kind: 'term', row: rowNo, existingId: termIdByName.get(logicalName) ?? null, draft, patch })
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
  return { entries, issues, total, bySheet, recognizedColumns }
}
