import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import { buildSampleModel } from './testing/fixtures.js'

describe('validateModelIntegrity', () => {
  it('returns no issues for a valid model', () => {
    expect(validateModelIntegrity(buildSampleModel())).toEqual([])
  })

  it('flags a column whose tableId does not exist', () => {
    const m = buildSampleModel()
    m.columns.c9 = { ...m.columns.c3!, id: 'c9', tableId: 'missing' }
    const issues = validateModelIntegrity(m)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ entity: 'column', entityId: 'c9' })
  })

  it('flags a table whose groupId does not exist', () => {
    const m = buildSampleModel()
    m.tables.t1!.groupId = 'missing'
    expect(validateModelIntegrity(m)).toHaveLength(1)
  })

  it('flags a relationship referencing a missing table', () => {
    const m = buildSampleModel()
    m.relationships.r1!.parentTableId = 'missing'
    expect(validateModelIntegrity(m).map((i) => i.entityId)).toEqual(['r1'])
  })

  it('flags a relationship mapping whose column belongs to the wrong table', () => {
    const m = buildSampleModel()
    // c3는 t2 소속인데 parent(t1) 쪽 컬럼으로 매핑
    m.relationships.r1!.columnMappings = [{ childColumnId: 'c4', parentColumnId: 'c3' }]
    expect(validateModelIntegrity(m)).toHaveLength(1)
  })

  it('flags an index column that does not belong to the index table', () => {
    const m = buildSampleModel()
    m.indexes.i1!.columns = [{ columnId: 'c1', direction: 'asc' }]
    expect(validateModelIntegrity(m)).toHaveLength(1)
  })

  it('flags a record whose key does not match entity.id', () => {
    const m = buildSampleModel()
    m.notes.nX = { id: 'n1', content: 'x', position: { x: 0, y: 0 }, color: '#fff' }
    const issues = validateModelIntegrity(m)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ entity: 'note', entityId: 'nX' })
  })

  it('flags a groupId that collides with a prototype property name', () => {
    const m = buildSampleModel()
    m.tables.t1!.groupId = 'constructor'
    expect(validateModelIntegrity(m)).toHaveLength(1)
  })

  it('flags a column whose domainId does not exist', () => {
    const m = buildSampleModel()
    m.columns.c1!.domainId = 'missing'
    const issues = validateModelIntegrity(m)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ entity: 'column', entityId: 'c1' })
  })
})
