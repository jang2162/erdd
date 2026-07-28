import { describe, expect, it } from 'vitest'
import { customFieldsFor, type CustomField, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import {
  createCustomField, moveCustomField, removeCustomField, setCustomValue, updateCustomField,
} from './custom-field-edits.js'

function newField(id: string, over: Partial<CustomField> = {}): Omit<CustomField, 'order'> {
  const { order: _order, ...rest } = {
    id, name: id, target: 'column' as const, type: 'text' as const, options: [] as string[],
    required: false, defaultValue: null, order: 0, origin: null, ...over,
  }
  return rest
}
function withFields(): ProjectModel {
  let m = buildSampleModel()
  m = createCustomField(m, newField('f1', { name: '개인정보여부' }))
  m = createCustomField(m, newField('f2', { name: '암호화방식' }))
  m = createCustomField(m, newField('t1f', { name: '업무구분', target: 'table' }))
  return m
}

describe('createCustomField', () => {
  it('같은 target 안에서 order를 최대+1로 부여한다', () => {
    const m = withFields()
    expect(customFieldsFor(m, 'column').map((f) => [f.id, f.order])).toEqual([['f1', 0], ['f2', 1]])
    expect(customFieldsFor(m, 'table').map((f) => [f.id, f.order])).toEqual([['t1f', 0]])
  })
})

describe('updateCustomField', () => {
  it('이름·필수·기본값·선택지를 갱신한다', () => {
    const m = updateCustomField(withFields(), 'f1', {
      name: '개인정보', required: true, defaultValue: 'N', options: ['Y', 'N'],
    })
    expect(m.customFields['f1']).toMatchObject({
      name: '개인정보', required: true, defaultValue: 'N', options: ['Y', 'N'], target: 'column',
    })
  })

  it('없는 id는 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(updateCustomField(m, 'nope', { name: 'x' })).toBe(m)
  })
})

describe('moveCustomField', () => {
  it('같은 target 안에서 인접 항목과 order를 교환한다', () => {
    const m = moveCustomField(withFields(), 'f2', -1)
    expect(customFieldsFor(m, 'column').map((f) => f.id)).toEqual(['f2', 'f1'])
  })

  it('다른 target의 항목 순서는 건드리지 않는다', () => {
    const m = moveCustomField(withFields(), 'f2', -1)
    expect(m.customFields['t1f']!.order).toBe(0)
  })

  it('경계를 넘으면 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(moveCustomField(m, 'f1', -1)).toBe(m)
    expect(moveCustomField(m, 'f2', 1)).toBe(m)
  })
})

describe('setCustomValue', () => {
  it('컬럼 값을 설정하고 빈 문자열이면 키를 지운다', () => {
    let m = setCustomValue(withFields(), 'column', 'c1', 'f1', 'Y')
    expect(m.columns['c1']!.custom).toEqual({ f1: 'Y' })
    m = setCustomValue(m, 'column', 'c1', 'f1', '')
    expect(m.columns['c1']!.custom).toEqual({})
  })

  it('테이블 값도 같은 방식으로 다룬다', () => {
    const m = setCustomValue(withFields(), 'table', 't1', 't1f', '공통')
    expect(m.tables['t1']!.custom).toEqual({ t1f: '공통' })
  })

  it('없는 엔티티는 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(setCustomValue(m, 'column', 'nope', 'f1', 'Y')).toBe(m)
  })
})

describe('removeCustomField', () => {
  it('정의와 함께 모든 테이블·컬럼의 값을 제거한다', () => {
    let m = withFields()
    m = setCustomValue(m, 'column', 'c1', 'f1', 'Y')
    m = setCustomValue(m, 'column', 'c2', 'f1', 'N')
    m = setCustomValue(m, 'column', 'c2', 'f2', 'AES256')
    m = removeCustomField(m, 'f1')

    expect(m.customFields['f1']).toBeUndefined()
    expect(m.columns['c1']!.custom).toEqual({})
    expect(m.columns['c2']!.custom).toEqual({ f2: 'AES256' })
  })

  it('테이블 대상 항목이면 테이블 값도 제거한다', () => {
    let m = withFields()
    m = setCustomValue(m, 'table', 't1', 't1f', '공통')
    m = removeCustomField(m, 't1f')
    expect(m.tables['t1']!.custom).toEqual({})
  })

  it('없는 id는 모델을 그대로 반환한다', () => {
    const m = withFields()
    expect(removeCustomField(m, 'nope')).toBe(m)
  })
})
