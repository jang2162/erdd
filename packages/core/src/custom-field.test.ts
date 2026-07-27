import { describe, expect, it } from 'vitest'
import { createEmptyModel, type CustomField, type ProjectModel } from './model.js'
import {
  customFieldsFor, customFieldUsageCount, customOptionUsageCount, resolveCustomValue,
} from './custom-field.js'

function field(id: string, over: Partial<CustomField> = {}): CustomField {
  return {
    id, name: id, target: 'column', type: 'text', options: [], required: false,
    defaultValue: null, order: 0, ...over,
  }
}
function modelWith(fields: CustomField[]): ProjectModel {
  const m = createEmptyModel()
  for (const f of fields) m.customFields[f.id] = f
  m.tables['T'] = {
    id: 'T', logicalName: 'T', physicalName: 'T', comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['C'] = {
    id: 'C', tableId: 'T', logicalName: 'C', physicalName: 'C', type: 'BIGINT', isPk: false,
    autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null,
    domainId: null, custom: {},
  }
  return m
}

describe('customFieldsFor', () => {
  it('target으로 거르고 order 오름차순으로 정렬한다', () => {
    const m = modelWith([
      field('b', { order: 2 }),
      field('a', { order: 1 }),
      field('t', { target: 'table', order: 0 }),
    ])
    expect(customFieldsFor(m, 'column').map((f) => f.id)).toEqual(['a', 'b'])
    expect(customFieldsFor(m, 'table').map((f) => f.id)).toEqual(['t'])
  })

  it('order가 같으면 이름순으로 안정 정렬한다', () => {
    const m = modelWith([field('z', { name: '나', order: 0 }), field('y', { name: '가', order: 0 })])
    expect(customFieldsFor(m, 'column').map((f) => f.id)).toEqual(['y', 'z'])
  })
})

describe('resolveCustomValue', () => {
  it('입력값 > 기본값 > 빈 문자열 순으로 해석한다', () => {
    const f = field('f', { defaultValue: 'N' })
    expect(resolveCustomValue({ custom: { f: 'Y' } }, f)).toBe('Y')
    expect(resolveCustomValue({ custom: {} }, f)).toBe('N')
    expect(resolveCustomValue({ custom: {} }, field('f'))).toBe('')
  })

  it('빈 문자열은 미입력으로 보고 기본값으로 되돌린다', () => {
    expect(resolveCustomValue({ custom: { f: '' } }, field('f', { defaultValue: 'N' }))).toBe('N')
  })
})

describe('usage counts', () => {
  it('값이 입력된 엔티티 수를 센다(빈 문자열은 제외)', () => {
    const m = modelWith([field('f')])
    expect(customFieldUsageCount(m, 'f')).toBe(0)
    m.columns['C']!.custom = { f: 'Y' }
    expect(customFieldUsageCount(m, 'f')).toBe(1)
    m.columns['C']!.custom = { f: '' }
    expect(customFieldUsageCount(m, 'f')).toBe(0)
  })

  it('target이 table이면 테이블 쪽을 센다', () => {
    const m = modelWith([field('f', { target: 'table' })])
    m.tables['T']!.custom = { f: 'Y' }
    expect(customFieldUsageCount(m, 'f')).toBe(1)
  })

  it('특정 선택지를 값으로 갖는 엔티티 수를 센다', () => {
    const m = modelWith([field('f', { type: 'select', options: ['AES256', 'SHA256'] })])
    m.columns['C']!.custom = { f: 'AES256' }
    expect(customOptionUsageCount(m, 'f', 'AES256')).toBe(1)
    expect(customOptionUsageCount(m, 'f', 'SHA256')).toBe(0)
  })

  it('없는 항목 id는 0을 반환한다', () => {
    const m = modelWith([])
    expect(customFieldUsageCount(m, 'nope')).toBe(0)
    expect(customOptionUsageCount(m, 'nope', 'x')).toBe(0)
  })
})
