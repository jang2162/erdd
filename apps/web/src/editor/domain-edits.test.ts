import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import { createDomain, updateDomain, removeDomain, usageOf } from './domain-edits.js'

const dom = (id: string, over = {}) => ({ id, name: '금액', category: null, logicalType: 'DECIMAL(15)',
  dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
  defaultValue: null, allowedValues: [], description: null, ...over })

describe('domain-edits', () => {
  it('createDomain/updateDomain', () => {
    let m = createEmptyModel()
    m = createDomain(m, dom('d1'))
    expect(m.domains['d1']!.name).toBe('금액')
    m = updateDomain(m, 'd1', { name: '통화' })
    expect(m.domains['d1']!.name).toBe('통화')
  })
  it('사용 중 도메인 삭제는 막고, 미사용은 삭제', () => {
    let m = createEmptyModel()
    m = createDomain(m, dom('d1'))
    m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
    m.columns['c'] = { id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A', type: 'INT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, domainId: 'd1' }
    expect(usageOf(m, 'd1').map((c) => c.id)).toEqual(['c'])
    expect(() => removeDomain(m, 'd1')).toThrow()
    m.columns['c']!.domainId = null
    expect(removeDomain(m, 'd1').domains['d1']).toBeUndefined()
  })
})
