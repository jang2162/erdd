import { type Domain, type ProjectModel, type Column } from '@erdd/core'

export function createDomain(model: ProjectModel, domain: Domain): ProjectModel {
  return { ...model, domains: { ...model.domains, [domain.id]: domain } }
}
export function updateDomain(model: ProjectModel, id: string, patch: Partial<Omit<Domain, 'id'>>): ProjectModel {
  const cur = model.domains[id]
  if (!cur) return model
  return { ...model, domains: { ...model.domains, [id]: { ...cur, ...patch } } }
}
export function usageOf(model: ProjectModel, domainId: string): Column[] {
  return Object.values(model.columns).filter((c) => c.domainId === domainId)
}
export function removeDomain(model: ProjectModel, id: string): ProjectModel {
  if (usageOf(model, id).length > 0) throw new Error('사용 중인 도메인은 삭제할 수 없습니다')
  const next = { ...model.domains }
  delete next[id]
  return { ...model, domains: next }
}
