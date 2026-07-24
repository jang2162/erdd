import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { addColumn, removeColumn, reorderColumn, updateColumn } from './column-edits.js'

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
})
