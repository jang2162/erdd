import type { DictImportPlan, Domain, ProjectModel, Term, Word } from '@erdd/core'

export type DictImportMode = 'skip' | 'overwrite'

/** 실제로 반영된 건수. 뮤테이션 summary와 완료 토스트에 쓴다. */
export type DictImportApplied = { words: number; terms: number; domains: number }

/**
 * 적용 계획을 모델에 반영한다.
 *
 * 도메인 → 단어 → 용어 순으로 처리한다. 용어의 기본 도메인 이름을 "도메인을 반영한 뒤의
 * 모델"에서 해석해야 같은 파일에서 새로 만들어진 도메인도 잡히기 때문이다.
 *
 * 덮어쓰기는 반드시 기존 id를 유지한다 — 새 id를 발급하면 그 도메인을 쓰던 컬럼의
 * domainId 참조가 끊긴다.
 *
 * 한 producer 안에서 3종을 모두 처리하므로 Revision 1건, undo 한 번으로 원복된다.
 */
export function applyDictImport(
  model: ProjectModel, plan: DictImportPlan, mode: DictImportMode, newId: () => string,
): ProjectModel {
  const domains = { ...model.domains }
  const words = { ...model.words }
  const terms = { ...model.terms }

  for (const e of plan.entries) {
    if (e.kind !== 'domain') continue
    if (e.existingId !== null) {
      if (mode === 'skip') continue
      const cur = domains[e.existingId]
      if (!cur) continue
      domains[e.existingId] = { ...cur, ...e.draft, id: e.existingId } satisfies Domain
    } else {
      const id = newId()
      domains[id] = { ...e.draft, id } satisfies Domain
    }
  }

  for (const e of plan.entries) {
    if (e.kind !== 'word') continue
    if (e.existingId !== null) {
      if (mode === 'skip') continue
      const cur = words[e.existingId]
      if (!cur) continue
      words[e.existingId] = { ...cur, ...e.draft, id: e.existingId } satisfies Word
    } else {
      const id = newId()
      words[id] = { ...e.draft, id } satisfies Word
    }
  }

  // 도메인을 반영한 뒤의 목록에서 이름으로 해석한다.
  const domainIdByName = new Map(Object.values(domains).map((d) => [d.name.trim(), d.id]))

  for (const e of plan.entries) {
    if (e.kind !== 'term') continue
    const { domainName, ...rest } = e.draft
    const domainId = domainName === '' ? null : (domainIdByName.get(domainName) ?? null)
    if (e.existingId !== null) {
      if (mode === 'skip') continue
      const cur = terms[e.existingId]
      if (!cur) continue
      terms[e.existingId] = { ...cur, ...rest, domainId, id: e.existingId } satisfies Term
    } else {
      const id = newId()
      terms[id] = { ...rest, domainId, id } satisfies Term
    }
  }

  return { ...model, domains, words, terms }
}

/** mode를 반영해 실제로 반영될 건수를 센다. */
export function countApplied(plan: DictImportPlan, mode: DictImportMode): DictImportApplied {
  const n = (kind: 'word' | 'term' | 'domain') => plan.entries
    .filter((e) => e.kind === kind && (mode === 'overwrite' || e.existingId === null)).length
  return { words: n('word'), terms: n('term'), domains: n('domain') }
}
