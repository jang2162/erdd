import { customFieldsFor, type CustomField, type ProjectModel } from '@erdd/core'

/** 같은 target 안에서 마지막 순서로 추가한다(order = 최대+1). */
export function createCustomField(
  model: ProjectModel, field: Omit<CustomField, 'order'>,
): ProjectModel {
  const siblings = customFieldsFor(model, field.target)
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((f) => f.order)) + 1
  const next: CustomField = { ...field, order }
  return { ...model, customFields: { ...model.customFields, [next.id]: next } }
}

/** 타입·대상·순서는 여기서 바꾸지 않는다(타입/대상은 변경 불허, 순서는 moveCustomField). */
export function updateCustomField(
  model: ProjectModel, id: string,
  patch: Partial<Omit<CustomField, 'id' | 'type' | 'target' | 'order'>>,
): ProjectModel {
  const cur = model.customFields[id]
  if (!cur) return model
  return { ...model, customFields: { ...model.customFields, [id]: { ...cur, ...patch } } }
}

/** 같은 target 안에서 인접 항목과 order를 교환한다. dir: -1 위로, +1 아래로. */
export function moveCustomField(model: ProjectModel, id: string, dir: -1 | 1): ProjectModel {
  const cur = model.customFields[id]
  if (!cur) return model
  const siblings = customFieldsFor(model, cur.target)
  const idx = siblings.findIndex((f) => f.id === id)
  const neighbor = siblings[idx + dir]
  if (!neighbor) return model
  return {
    ...model,
    customFields: {
      ...model.customFields,
      [cur.id]: { ...cur, order: neighbor.order },
      [neighbor.id]: { ...neighbor, order: cur.order },
    },
  }
}

/**
 * 정의 삭제 + 모든 테이블·컬럼의 해당 값 제거를 한 producer 안에서 수행한다.
 * 편집 1건이라 실행 취소 한 번으로 값까지 되살아난다(값이 5,000건을 넘으면 Revision 은 조각 수만큼 쌓인다 —
 * guides/data-layer.md 「한 요청의 op 상한은 …」).
 */
export function removeCustomField(model: ProjectModel, id: string): ProjectModel {
  const cur = model.customFields[id]
  if (!cur) return model
  const nextFields = { ...model.customFields }
  delete nextFields[id]

  const strip = <T extends { custom: Record<string, string> }>(
    rec: Record<string, T>,
  ): Record<string, T> => {
    let changed = false
    const out: Record<string, T> = {}
    for (const [key, entity] of Object.entries(rec)) {
      if (Object.hasOwn(entity.custom, id)) {
        const custom = { ...entity.custom }
        delete custom[id]
        out[key] = { ...entity, custom }
        changed = true
      } else {
        out[key] = entity
      }
    }
    return changed ? out : rec
  }

  return {
    ...model,
    customFields: nextFields,
    tables: cur.target === 'table' ? strip(model.tables) : model.tables,
    columns: cur.target === 'column' ? strip(model.columns) : model.columns,
  }
}

/** 값 설정. 빈 문자열이면 키를 지워 "미입력"으로 되돌린다(정의 기본값 해석이 다시 적용됨). */
export function setCustomValue(
  model: ProjectModel, target: 'table' | 'column', entityId: string,
  fieldId: string, value: string,
): ProjectModel {
  const patched = (custom: Record<string, string>): Record<string, string> => {
    const next = { ...custom }
    if (value === '') delete next[fieldId]
    else next[fieldId] = value
    return next
  }
  if (target === 'table') {
    const t = model.tables[entityId]
    if (!t) return model
    return { ...model, tables: { ...model.tables, [entityId]: { ...t, custom: patched(t.custom) } } }
  }
  const c = model.columns[entityId]
  if (!c) return model
  return { ...model, columns: { ...model.columns, [entityId]: { ...c, custom: patched(c.custom) } } }
}
