import { describe, expect, it } from 'vitest'
import { validateModelIntegrity } from './integrity.js'
import { createGroup, updateGroup, deleteGroup, setTableGroup } from './group.js'
import { createEmptyModel, type ProjectModel, type Table } from './model.js'

function tbl(id: string, over: Partial<Table> = {}): Table {
  return { id, logicalName: id, physicalName: id.toUpperCase(), comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, ...over }
}
function base(): ProjectModel {
  const m = createEmptyModel()
  m.tables['T1'] = tbl('T1')
  m.tables['T2'] = tbl('T2')
  return m
}

describe('createGroup', () => {
  it('그룹을 추가한다', () => {
    const next = createGroup(base(), { id: 'G1', name: '회원', color: '#0E7A6C' })
    expect(next.tableGroups['G1']).toMatchObject({ id: 'G1', name: '회원', color: '#0E7A6C', comment: null })
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('이미 있는 id는 no-op', () => {
    const m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    const again = createGroup(m, { id: 'G1', name: '다른이름', color: '#fff' })
    expect(again.tableGroups['G1']!.name).toBe('회원')
  })
})

describe('updateGroup', () => {
  it('이름·색상·설명을 바꾼다', () => {
    const m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    const next = updateGroup(m, 'G1', { name: '주문', color: '#C89B3C', comment: '주문 도메인' })
    expect(next.tableGroups['G1']).toMatchObject({ name: '주문', color: '#C89B3C', comment: '주문 도메인' })
  })
  it('없는 그룹은 no-op', () => {
    const m = base()
    expect(updateGroup(m, 'X', { name: 'y' })).toBe(m)
  })
})

describe('setTableGroup', () => {
  it('테이블을 그룹에 배정한다', () => {
    const m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    const next = setTableGroup(m, 'T1', 'G1')
    expect(next.tables['T1']!.groupId).toBe('G1')
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('null로 미배정한다', () => {
    let m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    m = setTableGroup(m, 'T1', 'G1')
    const next = setTableGroup(m, 'T1', null)
    expect(next.tables['T1']!.groupId).toBeNull()
  })
  it('존재하지 않는 그룹으로 배정하면 no-op', () => {
    const m = base()
    expect(setTableGroup(m, 'T1', 'NOPE')).toBe(m)
  })
  it('없는 테이블은 no-op', () => {
    const m = base()
    expect(setTableGroup(m, 'X', null)).toBe(m)
  })
})

describe('deleteGroup', () => {
  it('그룹을 지우고 멤버 테이블을 미배정으로 되돌린다', () => {
    let m = createGroup(base(), { id: 'G1', name: '회원', color: '#000' })
    m = setTableGroup(m, 'T1', 'G1')
    m = setTableGroup(m, 'T2', 'G1')
    const next = deleteGroup(m, 'G1')
    expect(next.tableGroups['G1']).toBeUndefined()
    expect(next.tables['T1']!.groupId).toBeNull()
    expect(next.tables['T2']!.groupId).toBeNull()
    expect(validateModelIntegrity(next)).toEqual([])
  })
  it('없는 그룹은 no-op', () => {
    const m = base()
    expect(deleteGroup(m, 'X')).toBe(m)
  })
})
