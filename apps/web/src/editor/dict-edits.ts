import {
  type Word, type Term, type Table, type Column, type ProjectModel, type NamingRules,
  generatePhysicalName, decomposeByWords, restoreLogicalName, findTermByLogicalName,
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

/**
 * 인라인 등록의 사전 판정. createWord·createTerm 에는 중복 검사가 없어서(같은 논리명 단어를 둘
 * 만들면 decomposeByWords 가 하나만 쓰고 나머지는 유령이 된다) 부르는 쪽이 막아야 한다.
 * 사전 화면의 일괄 등록은 미등록 목록에서 오므로 정의상 중복이 아니다 — 그래서 이 판정은
 * 인라인 등록 경로만 쓴다.
 */
export type RegisterCheck = { ok: boolean; reason?: 'empty' | 'duplicate'; abbrClash?: boolean }

export function canRegisterWord(
  model: ProjectModel, w: { logicalName: string; abbreviation: string },
): RegisterCheck {
  const logicalName = w.logicalName.trim()
  const abbreviation = w.abbreviation.trim()
  if (logicalName === '' || abbreviation === '') return { ok: false, reason: 'empty' }
  const values = Object.values(model.words)
  if (values.some((x) => x.logicalName.trim() === logicalName)) return { ok: false, reason: 'duplicate' }
  // 약어 충돌은 막지 않는다 — abbreviationIndex 가 id 가 작은 쪽으로 결정론적으로 고르므로
  // 무결성 문제가 아니고, 같은 약어를 쓰는 단어가 실제로 존재한다(표시만 경고한다).
  const abbrClash = values.some((x) => x.abbreviation.trim().toUpperCase() === abbreviation.toUpperCase())
  return { ok: true, abbrClash }
}

/**
 * ⚠️ 중복 판정도 **양쪽 strip** 이다(설계 D4). 평문으로 두면 `회원주문번호` 가 이미 있는데
 * `회원_주문_번호` 로 등록이 통과해 **같은 bare 이름에 매칭되는 용어가 둘** 생긴다 —
 * generatePhysicalName 의 `find` 가 모델 순서로 하나를 고르므로 나머지는 유령이 된다
 * (UI 가 「중복 아님」이라 하고 엔진은 「중복」으로 취급하는 어긋남).
 */
export function canRegisterTerm(
  model: ProjectModel, t: { logicalName: string; physicalName: string }, rules: NamingRules,
): RegisterCheck {
  const logicalName = t.logicalName.trim()
  const physicalName = t.physicalName.trim()
  if (logicalName === '' || physicalName === '') return { ok: false, reason: 'empty' }
  if (findTermByLogicalName(logicalName, model.terms, rules) !== undefined) {
    return { ok: false, reason: 'duplicate' }
  }
  return { ok: true }
}

export type DictUsageEntry =
  | { kind: 'table'; entity: Table }
  | { kind: 'column'; entity: Column }

/**
 * 논리명 name이 완전일치하는 용어를 갖는지(naming.ts generatePhysicalName의 1단계 규칙과 동일).
 * 완전일치 용어가 있으면 그 논리명은 단어 분해를 거치지 않는다.
 *
 * ⚠️ **양쪽에서 구분자를 벗겨 비교한다(설계 D4).** 여기만 평문으로 두면 용어로 끝나는 논리명이
 * 표기(`회원_주문_번호` vs `회원주문번호`)에 따라 분해로 내려가 사용처가 과다 계산된다 —
 * generatePhysicalName 은 매칭하는데 이 함수만 못 하는 어긋남이다.
 */
function matchesTermExactly(
  name: string, terms: Record<string, Term>, rules: NamingRules,
): boolean {
  return findTermByLogicalName(name, terms, rules) !== undefined
}

/**
 * logicalName을 generatePhysicalName과 동일한 최장일치 규칙으로 분해했을 때
 * wordId에 해당하는 단어가 실제로 매치에 쓰였는지 판정한다.
 */
function usesWord(
  logicalName: string, wordId: string, words: Record<string, Word>, terms: Record<string, Term>,
  rules: NamingRules,
): boolean {
  const name = logicalName.trim()
  if (name === '') return false
  if (matchesTermExactly(name, terms, rules)) return false
  return decomposeByWords(name, words, rules).some((s) => s.word?.id === wordId)
}

/**
 * 그 단어의 logicalName이 논리명 분해에 실제로 쓰인 테이블/컬럼 목록.
 * rules 는 분해 규칙이라 프로젝트의 것을 그대로 넘겨야 한다 — 기본값을 하드코딩하면
 * 구분자를 끈 프로젝트에서 사용처가 실제와 어긋난다.
 */
export function wordUsage(
  model: ProjectModel, wordId: string, rules: NamingRules,
): DictUsageEntry[] {
  const entries: DictUsageEntry[] = []
  for (const t of Object.values(model.tables)) {
    if (usesWord(t.logicalName, wordId, model.words, model.terms, rules)) entries.push({ kind: 'table', entity: t })
  }
  for (const c of Object.values(model.columns)) {
    if (usesWord(c.logicalName, wordId, model.words, model.terms, rules)) entries.push({ kind: 'column', entity: c })
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

/** 사전 목록의 사용처 색인 — 단어·용어 id → 사용처. 모든 id 가 키로 있다(없으면 빈 배열). */
export type UsageIndex = { words: Map<string, DictUsageEntry[]>; terms: Map<string, DictUsageEntry[]> }

/**
 * 모델을 **한 번** 훑어 모든 단어·용어의 사용처를 만든다. 사전 목록이 행마다 `wordUsage`/`termUsage` 를 부르면
 * 비용이 사전 행 수 × (테이블 + 컬럼)이라 대용량 사전에서 패널이 멈춘다.
 *
 * ⚠️ **결과는 같은 모델·규칙의 `wordUsage`/`termUsage` 와 같아야 한다**(순서까지). 삭제 확인·용어 수정 전파처럼
 * 한 건만 필요한 곳은 기존 함수를 계속 쓰므로, 두 경로가 갈리면 목록의 사용 수와 경고가 다른 수를 말한다.
 * 그래서 두 판정의 차이를 그대로 옮긴다 — 용어 사용처는 **평문 trim 완전일치**(`termUsage`), 단어 분해를 건너뛸
 * 용어 완전일치는 **양쪽 구분자를 벗겨** 비교한다(`matchesTermExactly`). `dict-edits.test.ts` 의
 * 「buildUsageIndex — 목록의 사용 수는…」 블록이 모든 id 에서 두 경로가 같음을 잠근다.
 */
export function buildUsageIndex(model: ProjectModel, rules: NamingRules): UsageIndex {
  const words = new Map<string, DictUsageEntry[]>()
  const terms = new Map<string, DictUsageEntry[]>()
  for (const id of Object.keys(model.words)) words.set(id, [])
  for (const id of Object.keys(model.terms)) terms.set(id, [])

  // termUsage: 논리명 trim 평문 → 용어 id 들.
  const termIdsByName = new Map<string, string[]>()
  for (const [id, term] of Object.entries(model.terms)) {
    const key = term.logicalName.trim()
    const ids = termIdsByName.get(key)
    if (ids) ids.push(id)
    else termIdsByName.set(key, [id])
  }
  // 같은 논리명의 테이블·컬럼이 많으므로 분해 결과를 이름으로 캐시한다.
  const wordIdsByName = new Map<string, ReadonlySet<string>>()
  const wordIdsOf = (name: string): ReadonlySet<string> => {
    const cached = wordIdsByName.get(name)
    if (cached) return cached
    const ids = name === '' || matchesTermExactly(name, model.terms, rules)
      ? new Set<string>()
      : new Set(decomposeByWords(name, model.words, rules).flatMap((s) => (s.word ? [s.word.id] : [])))
    wordIdsByName.set(name, ids)
    return ids
  }

  const visit = (entry: DictUsageEntry) => {
    const name = entry.entity.logicalName.trim()
    for (const id of termIdsByName.get(name) ?? []) terms.get(id)!.push(entry)
    for (const id of wordIdsOf(name)) words.get(id)?.push(entry)
  }
  for (const t of Object.values(model.tables)) visit({ kind: 'table', entity: t })
  for (const c of Object.values(model.columns)) visit({ kind: 'column', entity: c })
  return { words, terms }
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
 * updateTerm과 같은 producer 안에서 연달아 호출해 편집 1건(실행 취소 1회)으로 만든다.
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
    // restoreLogicalName 은 빈 이름에 {ok:false, unknownTokens:[]} 를 즉시 낸다(naming.ts:76-77).
    // 그래서 이 가드는 동작상 관찰되지 않는다 — 지워도 결과가 같다(빈 배열을 forEach해도 아무것도
    // 추가되지 않는다).
    // 정방향 unregisteredWords 의 빈 논리명 가드와 대칭을 이루려고 둔다.
    if (physicalName.trim() === '') return
    const r = restoreLogicalName(physicalName, model.words, model.terms, rules)
    if (!r.ok) r.unknownTokens.forEach((t) => set.add(t))
  }
  for (const t of Object.values(model.tables)) collect(t.physicalName)
  for (const c of Object.values(model.columns)) collect(c.physicalName)
  return [...set]
}
