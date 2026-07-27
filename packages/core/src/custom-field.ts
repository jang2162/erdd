import type { CustomField, ProjectModel } from './model.js'

/** target에 적용되는 커스텀 항목을 order 오름차순(동률은 이름순)으로 반환한다. */
export function customFieldsFor(model: ProjectModel, target: 'table' | 'column'): CustomField[] {
  return Object.values(model.customFields)
    .filter((f) => f.target === target)
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name))
}

/**
 * 커스텀 항목 값을 해석한다: 입력값 > 정의 기본값 > 빈 문자열.
 * 기본값은 스냅샷이 아니라 라이브 해석이다(도메인과 같은 철학) — 기본값을 고치면
 * 값을 입력하지 않은 엔티티에 즉시 반영된다. 빈 문자열은 미입력으로 본다.
 */
export function resolveCustomValue(
  entity: { custom: Record<string, string> }, field: CustomField,
): string {
  const v = entity.custom[field.id]
  if (v === undefined || v === '') return field.defaultValue ?? ''
  return v
}

function targetEntities(
  model: ProjectModel, target: 'table' | 'column',
): { custom: Record<string, string> }[] {
  return target === 'table' ? Object.values(model.tables) : Object.values(model.columns)
}

/** 값이 실제로 입력된(키가 있고 빈 문자열이 아닌) 테이블 또는 컬럼 수. 항목 삭제 확인 카피용. */
export function customFieldUsageCount(model: ProjectModel, fieldId: string): number {
  const field = model.customFields[fieldId]
  if (!field) return 0
  return targetEntities(model, field.target)
    .filter((e) => (e.custom[fieldId] ?? '') !== '').length
}

/** 그 선택지를 값으로 갖는 테이블 또는 컬럼 수. 선택지 삭제 가드용. */
export function customOptionUsageCount(
  model: ProjectModel, fieldId: string, option: string,
): number {
  const field = model.customFields[fieldId]
  if (!field) return 0
  return targetEntities(model, field.target).filter((e) => e.custom[fieldId] === option).length
}
