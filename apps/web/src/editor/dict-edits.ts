import {
  type Word, type Term, type Table, type Column, type ProjectModel, type NamingRules,
  generatePhysicalName, decomposeByWords, restoreLogicalName,
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

/** 전파로 바뀌는 필드 1건. 실제로 값이 달라지는 것만 만든다. */
export type TermPropagationChange = {
  field: 'logicalName' | 'physicalName' | 'domainId'
  before: string | null
  after: string | null
}

export type TermPropagationEntry = {
  kind: 'table' | 'column'
  entityId: string
  /** 화면 표시용. **수정 전 물리명** 기준(사용자가 목록에서 대상을 알아보려면 바뀌기 전 이름이어야 한다). */
  label: string
  changes: TermPropagationChange[]
}

export type TermPropagationPlan = { entries: TermPropagationEntry[] }

/**
 * 용어 수정을 사용처(테이블·컬럼)에 전파할 계획을 만든다. 순수 함수.
 *
 * ⚠️ **반드시 updateTerm을 적용하기 전의 모델을 넘겨야 한다.** termUsage가
 * `entity.logicalName === term.logicalName`으로 사용처를 찾으므로, 논리명이 바뀐 뒤의
 * 모델을 넘기면 매칭이 0건이 되어 전파가 조용히 사라진다.
 *
 * "바뀐 필드"는 patch에 키가 있고 값이 실제로 다른 것만 뜻한다(폼이 항상 모든 필드를
 * 채워 보내므로 이 구분이 없으면 안 바꾼 필드까지 전파된다).
 */
export function planTermPropagation(
  model: ProjectModel, termId: string, patch: Partial<Omit<Term, 'id'>>,
): TermPropagationPlan {
  const term = model.terms[termId]
  if (!term) return { entries: [] }

  const nextLogicalName = 'logicalName' in patch
    ? (patch.logicalName ?? '').trim() : term.logicalName.trim()
  const nextPhysicalName = 'physicalName' in patch
    ? (patch.physicalName ?? '').trim() : term.physicalName.trim()
  const nextDomainId = 'domainId' in patch ? (patch.domainId ?? null) : term.domainId

  const logicalChanged = nextLogicalName !== '' && nextLogicalName !== term.logicalName.trim()
  const physicalChanged = nextPhysicalName !== '' && nextPhysicalName !== term.physicalName.trim()
  // 용어에서 도메인을 떼는 것은 "쓰는 곳의 도메인을 지워라"가 아니다 — null 방향은 전파하지 않는다.
  const domainChanged = nextDomainId !== null && nextDomainId !== term.domainId

  if (!logicalChanged && !physicalChanged && !domainChanged) return { entries: [] }

  const entries: TermPropagationEntry[] = []
  for (const usage of termUsage(model, termId)) {
    const entity = usage.entity
    const changes: TermPropagationChange[] = []
    if (logicalChanged && entity.logicalName !== nextLogicalName) {
      changes.push({ field: 'logicalName', before: entity.logicalName, after: nextLogicalName })
    }
    if (physicalChanged && entity.physicalName !== nextPhysicalName) {
      changes.push({ field: 'physicalName', before: entity.physicalName, after: nextPhysicalName })
    }
    // 테이블에는 domainId 필드가 없다 — 컬럼만 대상.
    if (usage.kind === 'column' && domainChanged && usage.entity.domainId !== nextDomainId) {
      changes.push({ field: 'domainId', before: usage.entity.domainId, after: nextDomainId })
    }
    if (changes.length === 0) continue
    const label = usage.kind === 'column'
      ? `${model.tables[usage.entity.tableId]?.physicalName ?? '?'}.${usage.entity.physicalName}`
      : usage.entity.physicalName
    entries.push({ kind: usage.kind, entityId: entity.id, label, changes })
  }
  return { entries }
}

/**
 * 계획을 모델에 적용한다. 순수 함수.
 * updateTerm과 같은 producer 안에서 연달아 호출해 단일 mutation(Revision 1건)으로 만든다.
 * 계획을 세운 뒤 대상이 사라졌거나(남이 삭제) 그 필드를 남이 먼저 고쳤으면 건너뛴다 —
 * 확인 다이얼로그에서 보여준 것만 정확히 적용한다(원격 변경을 혼종으로 덮어쓰지 않는다).
 */
export function applyTermPropagation(model: ProjectModel, plan: TermPropagationPlan): ProjectModel {
  if (plan.entries.length === 0) return model
  const tables = { ...model.tables }
  const columns = { ...model.columns }
  for (const entry of plan.entries) {
    if (entry.kind === 'table') {
      const cur = tables[entry.entityId]
      if (!cur) continue
      const next = { ...cur }
      for (const c of entry.changes) {
        if (c.field === 'logicalName') {
          if (cur.logicalName !== c.before) continue   // 남이 먼저 고쳤다 — 덮어쓰지 않는다
          next.logicalName = c.after ?? ''
        } else if (c.field === 'physicalName') {
          if (cur.physicalName !== c.before) continue
          next.physicalName = c.after ?? ''
        }
      }
      tables[entry.entityId] = next
    } else {
      const cur = columns[entry.entityId]
      if (!cur) continue
      const next = { ...cur }
      for (const c of entry.changes) {
        if (c.field === 'logicalName') {
          if (cur.logicalName !== c.before) continue
          next.logicalName = c.after ?? ''
        } else if (c.field === 'physicalName') {
          if (cur.physicalName !== c.before) continue
          next.physicalName = c.after ?? ''
        } else {
          if (cur.domainId !== c.before) continue
          next.domainId = c.after
        }
      }
      columns[entry.entityId] = next
    }
  }
  return { ...model, tables, columns }
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

/**
 * 전 테이블·컬럼 물리명을 restoreLogicalName으로 훑었을 때 나오는 unknownTokens의 dedupe된 합집합.
 * unregisteredWords의 대칭 — 그쪽은 논리명에서 미등록 "단어"를, 이쪽은 물리명에서 미등록 "약어"를 낸다.
 */
export function unregisteredAbbreviations(model: ProjectModel, rules: NamingRules): string[] {
  const set = new Set<string>()
  const collect = (physicalName: string) => {
    if (physicalName.trim() === '') return
    const r = restoreLogicalName(physicalName, model.words, model.terms, rules)
    if (!r.ok) r.unknownTokens.forEach((t) => set.add(t))
  }
  for (const t of Object.values(model.tables)) collect(t.physicalName)
  for (const c of Object.values(model.columns)) collect(c.physicalName)
  return [...set]
}
