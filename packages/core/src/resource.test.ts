import { describe, expect, it } from 'vitest'
import {
  CustomFieldSchema, DomainSchema, TermSchema, WordSchema,
} from './model.js'
import {
  RESOURCE_KINDS, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL,
  RESOURCE_PAYLOAD_SCHEMAS, resourceDisplayName, resourcePayloadOf,
} from './resource.js'

describe('resource kinds', () => {
  it('4종을 고정 순서로 노출한다', () => {
    expect(RESOURCE_KINDS).toEqual(['domain', 'word', 'term', 'customField'])
  })

  it('컬렉션·라벨 매핑이 모든 종류를 덮는다', () => {
    for (const kind of RESOURCE_KINDS) {
      expect(RESOURCE_COLLECTION_BY_KIND[kind]).toBeTruthy()
      expect(RESOURCE_KIND_LABEL[kind]).toBeTruthy()
    }
  })
})

describe('RESOURCE_PAYLOAD_SCHEMAS', () => {
  const ENTITY_SHAPES = {
    domain: DomainSchema, word: WordSchema, term: TermSchema, customField: CustomFieldSchema,
  } as const

  it('엔티티 스키마에서 id·origin(+customField의 order)만 뺀 형태다', () => {
    for (const kind of RESOURCE_KINDS) {
      const dropped = kind === 'customField'
        ? ['id', 'origin', 'order']
        : ['id', 'origin']
      const expected = Object.keys(ENTITY_SHAPES[kind].shape)
        .filter((k) => !dropped.includes(k)).sort()
      expect(Object.keys(RESOURCE_PAYLOAD_SCHEMAS[kind].shape).sort()).toEqual(expected)
    }
  })

  it('id가 섞인 payload를 거부한다', () => {
    const res = RESOURCE_PAYLOAD_SCHEMAS.word.safeParse({
      id: 'w1', logicalName: '회원', abbreviation: 'MBR', description: null,
    })
    expect(res.success).toBe(false)
  })
})

describe('resourcePayloadOf', () => {
  it('도메인에서 id·origin을 뺀다', () => {
    const entity = {
      id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
      origin: { libraryId: 'l', sourceId: 's', sourceVersion: 1, base: {} },
    }
    const payload = resourcePayloadOf('domain', entity)
    expect(payload.id).toBeUndefined()
    expect(payload.origin).toBeUndefined()
    expect(payload.name).toBe('금액')
    expect(RESOURCE_PAYLOAD_SCHEMAS.domain.safeParse(payload).success).toBe(true)
  })

  it('커스텀 항목에서는 order도 뺀다 (순서는 프로젝트의 표시 관심사)', () => {
    const payload = resourcePayloadOf('customField', {
      id: 'f1', name: '개인정보여부', target: 'column', type: 'text',
      options: [], required: false, defaultValue: null, order: 7, origin: null,
    })
    expect(payload.order).toBeUndefined()
    expect(RESOURCE_PAYLOAD_SCHEMAS.customField.safeParse(payload).success).toBe(true)
  })
})

describe('resourceDisplayName', () => {
  it('도메인·커스텀 항목은 name, 단어·용어는 logicalName을 쓴다', () => {
    expect(resourceDisplayName('domain', { name: '금액' })).toBe('금액')
    expect(resourceDisplayName('customField', { name: '개인정보여부' })).toBe('개인정보여부')
    expect(resourceDisplayName('word', { logicalName: '회원' })).toBe('회원')
    expect(resourceDisplayName('term', { logicalName: '회원번호' })).toBe('회원번호')
  })

  it('이름 필드가 없으면 빈 문자열', () => {
    expect(resourceDisplayName('word', {})).toBe('')
  })
})
