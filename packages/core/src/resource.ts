import type { z } from 'zod'
import {
  CustomFieldSchema, DomainSchema, TermSchema, WordSchema, type Origin, type ProjectModel,
} from './model.js'

/** 공용 리소스로 다루는 엔티티 종류. 배열 순서 = 화면 표시 순서. */
export const RESOURCE_KINDS = ['domain', 'word', 'term', 'customField'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export const RESOURCE_COLLECTION_BY_KIND = {
  domain: 'domains', word: 'words', term: 'terms', customField: 'customFields',
} as const satisfies Record<ResourceKind, keyof ProjectModel>

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  domain: '도메인', word: '단어', term: '용어', customField: '커스텀 항목',
}

/**
 * 라이브러리 항목 payload 스키마 — 엔티티에서 id·origin(+ customField의 order)을 뺀 형태.
 * customField의 order를 빼는 이유: 순서는 프로젝트의 표시 관심사다. payload에 넣으면
 * 사용자가 패널에서 순서만 바꿔도 "프로젝트 수정"으로 잡혀 엉뚱한 충돌이 난다.
 */
export const RESOURCE_PAYLOAD_SCHEMAS = {
  domain: DomainSchema.omit({ id: true, origin: true }),
  word: WordSchema.omit({ id: true, origin: true }),
  term: TermSchema.omit({ id: true, origin: true }),
  customField: CustomFieldSchema.omit({ id: true, origin: true, order: true }),
} satisfies Record<ResourceKind, z.ZodType>

const DROPPED_KEYS = ['id', 'origin'] as const

/** 엔티티 → payload 투영(비교·저장 공용). RESOURCE_PAYLOAD_SCHEMAS와 키 집합이 일치한다. */
export function resourcePayloadOf(
  kind: ResourceKind, entity: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entity)) {
    if ((DROPPED_KEYS as readonly string[]).includes(key)) continue
    if (kind === 'customField' && key === 'order') continue
    out[key] = value
  }
  return out
}

/** 목록·충돌 화면에 쓰는 표시 이름. */
export function resourceDisplayName(
  kind: ResourceKind, payload: Record<string, unknown>,
): string {
  const key = kind === 'domain' || kind === 'customField' ? 'name' : 'logicalName'
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

/**
 * 목록·충돌 화면의 **물리명 칸**. 단어는 약어, 용어는 물리명이고 도메인·커스텀 항목은 없다(null).
 * 관리 모달·에디터 패널·재동기화·승격 행이 모두 이 함수로 두 번째 칸을 그린다 — 화면마다 payload 를
 * 따로 읽으면 한쪽만 바뀐다. 논리명 칸은 `resourceDisplayName` 이다.
 */
export function resourceSecondaryName(
  kind: ResourceKind, payload: Record<string, unknown>,
): string | null {
  const key = kind === 'word' ? 'abbreviation' : kind === 'term' ? 'physicalName' : null
  if (key === null) return null
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

/** 공용 리소스 4종의 프로젝트 엔티티 목록. planResync·planPromote가 함께 쓴다. */
export function resourceEntitiesOf(
  model: ProjectModel, kind: ResourceKind,
): { id: string; origin: Origin | null }[] {
  const collection = model[RESOURCE_COLLECTION_BY_KIND[kind]] as unknown as
    Record<string, { id: string; origin: Origin | null }>
  return Object.values(collection)
}
