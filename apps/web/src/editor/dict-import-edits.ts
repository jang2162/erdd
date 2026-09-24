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
 * 신규는 draft(완전값), 덮어쓰기는 patch(시트에 있던 컬럼만)를 쓴다. 컬럼이 통째로 없는
 * 시트로 덮어쓸 때 그 필드가 조용히 비워지는 것을 막기 위해서다.
 *
 * 덮어쓰기는 반드시 기존 id를 유지한다 — 새 id를 발급하면 그 도메인을 쓰던 컬럼의
 * domainId 참조가 끊긴다.
 *
 * 한 producer 안에서 3종을 모두 처리하므로 편집 1건 — 실행 취소 한 번으로 원복된다(5,000건을 넘으면 Revision 은
 * 조각 수만큼 쌓인다 — guides/data-layer.md 「한 요청의 op 상한은 …」).
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
      const { dialectTypes, ...rest } = e.patch
      domains[e.existingId] = {
        ...cur, ...rest,
        // 방언은 컬럼 단위로 인식하므로 있는 방언만 갈아끼운다.
        dialectTypes: { ...cur.dialectTypes, ...dialectTypes },
        id: e.existingId,
      } satisfies Domain
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
      words[e.existingId] = { ...cur, ...e.patch, id: e.existingId } satisfies Word
    } else {
      const id = newId()
      words[id] = { ...e.draft, id } satisfies Word
    }
  }

  // 도메인을 반영한 뒤의 목록에서 이름으로 해석한다.
  const domainIdByName = new Map(Object.values(domains).map((d) => [d.name.trim(), d.id]))

  /** 이름 → id. 빈 이름은 "도메인 없음"이다. */
  const resolveDomain = (name: string): string | null =>
    (name === '' ? null : (domainIdByName.get(name) ?? null))

  for (const e of plan.entries) {
    if (e.kind !== 'term') continue
    if (e.existingId !== null) {
      if (mode === 'skip') continue
      const cur = terms[e.existingId]
      if (!cur) continue
      const { domainName, ...rest } = e.patch
      terms[e.existingId] = {
        ...cur, ...rest,
        // "기본 도메인" 컬럼이 없던 시트면 기존 domainId를 그대로 둔다.
        ...(domainName === undefined ? {} : { domainId: resolveDomain(domainName) }),
        id: e.existingId,
      } satisfies Term
    } else {
      const { domainName, ...rest } = e.draft
      const id = newId()
      terms[id] = { ...rest, domainId: resolveDomain(domainName), id } satisfies Term
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
