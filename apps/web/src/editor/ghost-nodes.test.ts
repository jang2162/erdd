import { describe, expect, it } from 'vitest'
import { buildGhostNodes } from './ghost-nodes.js'
import { createEmptyModel, type ProjectModel, type Table, type Relationship } from '@erdd/core'

function tbl(id: string, groupId: string | null): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId,
    position: { x: 0, y: 0 }, groupPosition: null }
}
function model(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['G1'] = { id: 'G1', name: '주문', color: '#000', comment: null }
  m.tableGroups['G2'] = { id: 'G2', name: '회원', color: '#111', comment: null }
  m.tables['ORD'] = tbl('ORD', 'G1')   // 그룹 내
  m.tables['USR'] = tbl('USR', 'G2')   // 다른 그룹
  m.tables['LOG'] = tbl('LOG', null)   // 미분류
  m.tables['FAR'] = tbl('FAR', 'G2')   // 관계 없음
  const rel = (id: string, p: string, c: string): Relationship => ({
    id, parentTableId: p, childTableId: c, columnMappings: [], cardinality: '1:N', identifying: false, name: null })
  m.relationships['R1'] = rel('R1', 'USR', 'ORD') // USR(외부)↔ORD(내부)
  m.relationships['R2'] = rel('R2', 'ORD', 'LOG') // ORD(내부)↔LOG(미분류 외부)
  return m
}

describe('buildGhostNodes', () => {
  it('그룹 내 테이블과 관계된 외부 테이블만 고스트로 만든다', () => {
    const ghosts = buildGhostNodes(model(), 'G1')
    const ids = ghosts.map((g) => g.id).sort()
    expect(ids).toEqual(['ghost:LOG', 'ghost:USR']) // FAR는 관계 없어 제외, ORD는 내부라 제외
  })
  it('고스트에 targetGroupId를 담는다(미분류는 null)', () => {
    const ghosts = buildGhostNodes(model(), 'G1')
    const usr = ghosts.find((g) => g.id === 'ghost:USR')!
    const log = ghosts.find((g) => g.id === 'ghost:LOG')!
    expect((usr.data as { targetGroupId: string | null }).targetGroupId).toBe('G2')
    expect((log.data as { targetGroupId: string | null }).targetGroupId).toBeNull()
    expect(usr.type).toBe('ghost')
    expect(usr.draggable).toBe(false)
  })
})
