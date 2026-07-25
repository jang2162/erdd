import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import {
  addColumn, clearColumnDomain, removeColumn, reorderColumn, setColumnDomain, updateColumn,
} from './column-edits.js'

describe('column-edits', () => {
  it('addColumn appends with the next order', () => {
    const base = buildSampleModel()
    const m = addColumn(base, 't2', { id: 'c-new' })
    const cols = Object.values(m.columns).filter((c) => c.tableId === 't2')
    const added = m.columns['c-new']!
    expect(added.order).toBe(Math.max(...cols.filter((c) => c.id !== 'c-new').map((c) => c.order)) + 1)
    expect(added.type).not.toBe('')
  })

  it('updateColumn patches fields', () => {
    const base = buildSampleModel()
    const m = updateColumn(base, 'c3', { logicalName: '고객명', isPk: true })
    expect(m.columns['c3']).toMatchObject({ logicalName: '고객명', isPk: true })
  })

  it('removeColumn drops the column', () => {
    const base = buildSampleModel()
    const m = removeColumn(base, 'c3')
    expect(m.columns['c3']).toBeUndefined()
  })

  it('reorderColumn swaps order with the neighbor in the same table', () => {
    const base = buildSampleModel()
    // t2: c2(0), c3(1), c4(2)
    const m = reorderColumn(base, 'c3', -1)
    expect(m.columns['c3']!.order).toBe(0)
    expect(m.columns['c2']!.order).toBe(1)
  })

  it('setColumnDomain은 domainId를 설정하고, clearColumnDomain은 해제하며 해석 논리타입을 type에 복사', () => {
    let m = createEmptyModel()
    m.domains['d'] = { id: 'd', name: '여부', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null }
    m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null }
    m.columns['c'] = { id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A', type: 'INT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0, comment: null, domainId: null }
    m = setColumnDomain(m, 'c', 'd')
    expect(m.columns['c']!.domainId).toBe('d')
    m = clearColumnDomain(m, 'c')
    expect(m.columns['c']!.domainId).toBeNull()
    expect(m.columns['c']!.type).toBe('CHAR(1)') // 해석 논리타입 복사
  })
})
