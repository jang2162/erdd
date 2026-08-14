import type { Word, Term } from './model.js'

export type NamingRules = { case: 'UPPER_SNAKE' | 'lower_snake'; separator: '_' | ''; maxLengthBytes: number }
export const DEFAULT_NAMING_RULES: NamingRules = { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }
export type GenResult = { physicalName: string; unknownWords: string[]; termId?: string; domainId?: string | null }

/** 논리명 분해 결과 한 조각. word가 null이면 사전에 없는 구간이다. */
export type WordSegment = { text: string; word: Word | null }

/**
 * 논리명을 단어 사전으로 최장일치 그리디 분해한다.
 * 매칭 실패 구간은 연속으로 모아 word: null 세그먼트 하나가 된다.
 * 세그먼트 text를 이어붙이면 trim된 원본 논리명이 복원된다.
 * generatePhysicalName의 2단계와 동일 알고리즘 — 그쪽이 이 함수를 호출한다.
 */
export function decomposeByWords(logicalName: string, words: Record<string, Word>): WordSegment[] {
  const name = logicalName.trim()
  const byLen = Object.values(words).slice().sort((a, b) => b.logicalName.length - a.logicalName.length)
  const segments: WordSegment[] = []
  let i = 0
  let pending = ''
  while (i < name.length) {
    const match = byLen.find((w) => w.logicalName.length > 0 && name.startsWith(w.logicalName, i))
    if (match) {
      if (pending) { segments.push({ text: pending, word: null }); pending = '' }
      segments.push({ text: match.logicalName, word: match })
      i += match.logicalName.length
    } else {
      pending += name[i]!; i += 1
    }
  }
  if (pending) segments.push({ text: pending, word: null })
  return segments
}

export function generatePhysicalName(
  logicalName: string, words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): GenResult {
  const name = logicalName.trim()
  // 1) 용어 완전일치
  const term = Object.values(terms).find((t) => t.logicalName.trim() === name)
  if (term) return { physicalName: term.physicalName, unknownWords: [], termId: term.id, domainId: term.domainId }
  // 2) 최장일치 분해조합
  const segments = decomposeByWords(name, words)
  const parts = segments.filter((s) => s.word !== null).map((s) => s.word!.abbreviation)
  const unknownWords = segments.filter((s) => s.word === null).map((s) => s.text)
  const joined = parts.join(rules.separator)
  const physicalName = rules.case === 'lower_snake' ? joined.toLowerCase() : joined.toUpperCase()
  return { physicalName, unknownWords }
}

export type RestoreLogicalResult =
  | { ok: true; logicalName: string }
  | { ok: false; unknownTokens: string[] }

/** 약어(대문자) → 단어. 같은 약어를 가진 단어가 여럿이면 id가 작은 쪽으로 결정론적으로 고른다. */
function abbreviationIndex(words: Record<string, Word>): Map<string, Word> {
  const index = new Map<string, Word>()
  for (const w of Object.values(words).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = w.abbreviation.trim().toUpperCase()
    if (key !== '' && !index.has(key)) index.set(key, w)
  }
  return index
}

/**
 * generatePhysicalName의 역함수. 모든 토큰이 매칭될 때만 ok:true.
 * ⚠️ generatePhysicalName의 분해 규칙을 고치면 이 함수도 함께 고쳐야 한다 — 그래서 같은 파일에 둔다.
 */
export function restoreLogicalName(
  physicalName: string, words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): RestoreLogicalResult {
  const name = physicalName.trim()
  if (name === '') return { ok: false, unknownTokens: [] }

  // 1) 용어 물리명 완전일치 — generatePhysicalName의 1단계와 대칭
  const upper = name.toUpperCase()
  const term = Object.values(terms).find((t) => t.physicalName.trim().toUpperCase() === upper)
  if (term) return { ok: true, logicalName: term.logicalName }

  const index = abbreviationIndex(words)

  // 2-a) 구분자가 있으면 쪼개서 토큰별로 정확히 맞춘다
  if (rules.separator !== '') {
    const tokens = name.split(rules.separator).filter((t) => t !== '')
    if (tokens.length === 0) return { ok: false, unknownTokens: [] }
    const unknownTokens = tokens.filter((t) => !index.has(t.toUpperCase()))
    if (unknownTokens.length > 0) return { ok: false, unknownTokens }
    return { ok: true, logicalName: tokens.map((t) => index.get(t.toUpperCase())!.logicalName).join('') }
  }

  // 2-b) 구분자가 없으면 최장일치 그리디 — decomposeByWords의 약어판
  const byLen = [...index.entries()].sort((a, b) => b[0].length - a[0].length)
  const parts: string[] = []
  const unknownTokens: string[] = []
  let i = 0
  let pending = ''
  while (i < upper.length) {
    const hit = byLen.find(([abbr]) => upper.startsWith(abbr, i))
    if (hit) {
      if (pending) { unknownTokens.push(pending); pending = '' }
      parts.push(hit[1].logicalName)
      i += hit[0].length
    } else {
      pending += upper[i]!; i += 1
    }
  }
  if (pending) unknownTokens.push(pending)
  if (unknownTokens.length > 0) return { ok: false, unknownTokens }
  return { ok: true, logicalName: parts.join('') }
}

/** 자동완성 후보 하나. 넣는 방법은 `input.slice(0, start) + insert` 다. */
export type Completion = { insert: string; hint: string; kind: 'word' | 'term'; start: number }
export type CompletionResult = { query: string; items: Completion[] }

/** 한 번에 보여 주는 후보 수. 이 위로는 목록이 스크롤되어 고르는 비용이 타이핑보다 커진다. */
const MAX_COMPLETIONS = 8

/**
 * 입력 중인 이름의 **아직 사전에 매칭되지 않은 꼬리 한 조각**을 쿼리로 삼아 후보를 낸다.
 *
 * ⚠️ 쿼리 산출은 generatePhysicalName·restoreLogicalName과 **같은 분해 규칙**을 써야 한다 —
 * 그래서 이 파일에 있다(abbreviationIndex도 이 파일의 private 함수다).
 *
 * 용어만 **입력 전체**로 찾는다. 용어는 논리명 전체 완전일치가 적용 규칙이므로(generatePhysicalName
 * 1단계) 꼬리 조각으로 찾으면 의미가 달라진다. 그래서 용어 후보의 start는 0이다.
 *
 * 앞뒤 공백이 있는 입력은 후보를 내지 않는다 — decomposeByWords가 trim된 이름을 다루므로
 * 세그먼트 길이로 계산한 start가 원본 input에서 어긋난다.
 */
export function suggestCompletions(
  input: string, side: 'logical' | 'physical',
  words: Record<string, Word>, terms: Record<string, Term>, rules: NamingRules,
): CompletionResult {
  const none: CompletionResult = { query: '', items: [] }
  if (input === '' || input !== input.trim()) return none

  const query = side === 'logical'
    ? logicalQuery(input, words)
    : physicalQuery(input, words, rules)
  if (query === '') return none

  const start = input.length - query.length
  const seen = new Set<string>()
  const push = (list: Completion[], c: Completion) => {
    if (c.insert === '' || seen.has(`${c.kind} ${c.insert}`)) return
    seen.add(`${c.kind} ${c.insert}`)
    list.push(c)
  }

  // 용어 먼저 — generatePhysicalName이 용어를 먼저 보는 것과 같은 우선순위다.
  const termItems: Completion[] = []
  for (const t of Object.values(terms)) {
    const target = side === 'logical' ? t.logicalName : t.physicalName
    if (!startsWithFold(target, input, side) || foldEq(target, input, side)) continue
    push(termItems, {
      insert: target, hint: side === 'logical' ? t.physicalName : t.logicalName,
      kind: 'term', start: 0,
    })
  }

  const wordItems: Completion[] = []
  for (const w of Object.values(words)) {
    const target = side === 'logical' ? w.logicalName : w.abbreviation
    if (!startsWithFold(target, query, side) || foldEq(target, query, side)) continue
    push(wordItems, {
      insert: target, hint: side === 'logical' ? w.abbreviation : w.logicalName,
      kind: 'word', start,
    })
  }

  const byLength = (a: Completion, b: Completion) => (
    a.insert.length !== b.insert.length
      ? a.insert.length - b.insert.length
      : (a.insert < b.insert ? -1 : a.insert > b.insert ? 1 : 0)
  )
  termItems.sort(byLength)
  wordItems.sort(byLength)
  return { query, items: [...termItems, ...wordItems].slice(0, MAX_COMPLETIONS) }
}

/** 물리명 쪽만 대소문자를 접어 비교한다(약어는 대문자 규약이지만 소문자로 치는 것을 허용한다). */
function fold(s: string, side: 'logical' | 'physical'): string {
  return side === 'physical' ? s.toUpperCase() : s
}
function startsWithFold(target: string, prefix: string, side: 'logical' | 'physical'): boolean {
  return target !== '' && fold(target, side).startsWith(fold(prefix, side))
}
function foldEq(a: string, b: string, side: 'logical' | 'physical'): boolean {
  return fold(a, side) === fold(b, side)
}

/** 논리명의 미매칭 꼬리. decomposeByWords의 마지막 세그먼트가 word:null일 때만 있다. */
function logicalQuery(input: string, words: Record<string, Word>): string {
  const segments = decomposeByWords(input, words)
  const last = segments[segments.length - 1]
  return last && last.word === null ? last.text : ''
}

/** 물리명의 미매칭 꼬리. 구분자가 있으면 마지막 구분자 뒤, 없으면 약어 그리디의 잔여다. */
function physicalQuery(input: string, words: Record<string, Word>, rules: NamingRules): string {
  if (rules.separator !== '') {
    const idx = input.lastIndexOf(rules.separator)
    return idx === -1 ? input : input.slice(idx + rules.separator.length)
  }
  const index = abbreviationIndex(words)
  const byLen = [...index.keys()].sort((a, b) => b.length - a.length)
  const upper = input.toUpperCase()
  let i = 0
  let pending = ''
  while (i < upper.length) {
    const hit = byLen.find((abbr) => upper.startsWith(abbr, i))
    if (hit) { pending = ''; i += hit.length } else { pending += input[i]!; i += 1 }
  }
  return pending
}
