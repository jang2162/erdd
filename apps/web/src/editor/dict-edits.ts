import {
  type Word, type Term, type Table, type Column, type ProjectModel, type NamingRules,
  generatePhysicalName, decomposeByWords,
} from '@erdd/core'

export function createWord(model: ProjectModel, word: Word): ProjectModel {
  return { ...model, words: { ...model.words, [word.id]: word } }
}
export function updateWord(model: ProjectModel, id: string, patch: Partial<Omit<Word, 'id'>>): ProjectModel {
  const cur = model.words[id]
  if (!cur) return model
  return { ...model, words: { ...model.words, [id]: { ...cur, ...patch } } }
}
export function removeWord(model: ProjectModel, id: string): ProjectModel {
  // 가드 없음 — 사용 중이어도 삭제된다(사용처는 UI 안내만).
  const next = { ...model.words }
  delete next[id]
  return { ...model, words: next }
}

export function createTerm(model: ProjectModel, term: Term): ProjectModel {
  return { ...model, terms: { ...model.terms, [term.id]: term } }
}
export function updateTerm(model: ProjectModel, id: string, patch: Partial<Omit<Term, 'id'>>): ProjectModel {
  const cur = model.terms[id]
  if (!cur) return model
  return { ...model, terms: { ...model.terms, [id]: { ...cur, ...patch } } }
}
export function removeTerm(model: ProjectModel, id: string): ProjectModel {
  // 가드 없음 — 사용 중이어도 삭제된다(사용처는 UI 안내만).
  const next = { ...model.terms }
  delete next[id]
  return { ...model, terms: next }
}

export type DictUsageEntry =
  | { kind: 'table'; entity: Table }
  | { kind: 'column'; entity: Column }

/**
 * 논리명 name이 완전일치하는 용어를 갖는지(naming.ts generatePhysicalName의 1단계 규칙과 동일).
 * 완전일치 용어가 있으면 그 논리명은 단어 분해를 거치지 않는다.
 */
function matchesTermExactly(name: string, terms: Record<string, Term>): boolean {
  const trimmed = name.trim()
  return Object.values(terms).some((t) => t.logicalName.trim() === trimmed)
}

/**
 * logicalName을 generatePhysicalName과 동일한 최장일치 규칙으로 분해했을 때
 * wordId에 해당하는 단어가 실제로 매치에 쓰였는지 판정한다.
 */
function usesWord(
  logicalName: string, wordId: string, words: Record<string, Word>, terms: Record<string, Term>,
): boolean {
  const name = logicalName.trim()
  if (name === '') return false
  if (matchesTermExactly(name, terms)) return false
  return decomposeByWords(name, words).some((s) => s.word?.id === wordId)
}

/** 그 단어의 logicalName이 논리명 분해에 실제로 쓰인 테이블/컬럼 목록. */
export function wordUsage(model: ProjectModel, wordId: string): DictUsageEntry[] {
  const entries: DictUsageEntry[] = []
  for (const t of Object.values(model.tables)) {
    if (usesWord(t.logicalName, wordId, model.words, model.terms)) entries.push({ kind: 'table', entity: t })
  }
  for (const c of Object.values(model.columns)) {
    if (usesWord(c.logicalName, wordId, model.words, model.terms)) entries.push({ kind: 'column', entity: c })
  }
  return entries
}

/** 논리명이 term.logicalName과 일치하는 테이블/컬럼 목록. */
export function termUsage(model: ProjectModel, termId: string): DictUsageEntry[] {
  const term = model.terms[termId]
  if (!term) return []
  const target = term.logicalName.trim()
  const entries: DictUsageEntry[] = []
  for (const t of Object.values(model.tables)) {
    if (t.logicalName.trim() === target) entries.push({ kind: 'table', entity: t })
  }
  for (const c of Object.values(model.columns)) {
    if (c.logicalName.trim() === target) entries.push({ kind: 'column', entity: c })
  }
  return entries
}

/** 전 테이블·컬럼 논리명을 generatePhysicalName으로 분해했을 때 나오는 unknownWords의 dedupe된 합집합. */
export function unregisteredWords(model: ProjectModel, rules: NamingRules): string[] {
  const set = new Set<string>()
  for (const t of Object.values(model.tables)) {
    if (t.logicalName.trim() === '') continue
    const gen = generatePhysicalName(t.logicalName, model.words, model.terms, rules)
    gen.unknownWords.forEach((w) => set.add(w))
  }
  for (const c of Object.values(model.columns)) {
    if (c.logicalName.trim() === '') continue
    const gen = generatePhysicalName(c.logicalName, model.words, model.terms, rules)
    gen.unknownWords.forEach((w) => set.add(w))
  }
  return [...set]
}
