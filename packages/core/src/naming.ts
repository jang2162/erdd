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
