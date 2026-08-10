import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel, type Table } from '@erdd/core'
import { planGroupMove, tableBounds } from './group-move.js'

/** 컬럼 0개인 테이블. estHeight(0) = 44 + 1*28 = 72, 폭은 EST_W = 260. */
function tbl(id: string, groupId: string | null, x: number, y: number): Table {
  return {
    id, logicalName: id, physicalName: id.toUpperCase(), comment: null,
    groupId, position: { x, y }, groupPosition: null, custom: {},
  }
}

function modelWith(tables: Table[], groupIds: string[]): ProjectModel {
  const m = createEmptyModel()
  for (const g of groupIds) m.tableGroups[g] = { id: g, name: g, color: '#fff', comment: null }
  for (const t of tables) m.tables[t.id] = t
  return m
}

describe('tableBounds', () => {
  it('빈 목록이면 null이다', () => {
    expect(tableBounds(createEmptyModel(), [])).toBeNull()
  })

  it('컬럼 0개 테이블 하나의 bbox는 위치 + (260, 72)다', () => {
    const t = tbl('a', null, 100, 50)
    expect(tableBounds(modelWith([t], []), [t])).toEqual({ minX: 100, minY: 50, maxX: 360, maxY: 122 })
  })
})

describe('planGroupMove', () => {
  it('대상 그룹 오른쪽으로 옮기고 상대 배치를 보존한다', () => {
    // 대상 그룹 gB: (0,0) 한 개 → bbox maxX = 260
    // 이동 대상 a1(500,100)·a2(600,200) → 집합 minX=500, minY=100
    // delta.x = 260 + 60 - 500 = -180 · delta.y = 0 - 100 = -100
    const model = modelWith(
      [tbl('b1', 'gB', 0, 0), tbl('a1', 'gA', 500, 100), tbl('a2', 'gA', 600, 200)],
      ['gA', 'gB'],
    )
    const moves = planGroupMove(model, ['a1', 'a2'], 'gB')
    expect(moves).toEqual([
      { id: 'a1', position: { x: 320, y: 0 } },
      { id: 'a2', position: { x: 420, y: 100 } },
    ])
    // 상대 배치 보존: 이동 전 (100, 100) 차이가 그대로다.
    const [m1, m2] = moves
    expect(m2!.position.x - m1!.position.x).toBe(100)
    expect(m2!.position.y - m1!.position.y).toBe(100)
    // 대상 그룹 bbox 오른쪽에 있다.
    expect(m1!.position.x).toBeGreaterThan(260)
  })

  it('대상 그룹에 멤버가 없으면 좌표를 건드리지 않는다(기준으로 삼을 영역이 없다)', () => {
    const model = modelWith([tbl('a1', 'gA', 500, 100)], ['gA', 'gEmpty'])
    expect(planGroupMove(model, ['a1'], 'gEmpty')).toEqual([])
  })

  it('미분류로 옮기면 좌표를 건드리지 않는다', () => {
    const model = modelWith([tbl('b1', 'gB', 0, 0), tbl('a1', 'gA', 500, 100)], ['gA', 'gB'])
    expect(planGroupMove(model, ['a1'], null)).toEqual([])
  })

  it('미분류에 다른 테이블이 있어도 미분류로 옮기면 좌표를 건드리지 않는다', () => {
    // 계획의 앞 테스트는 미분류 테이블이 없는 모델을 쓴다 — targetGroupId 조기 반환을 지워도
    // 앵커가 비어 같은 []가 나오므로 구분력이 없다. 미분류는 그룹 영역 자체가 없으니, 미분류
    // 테이블들의 bbox를 기준으로 삼으면 근거 없는 좌표가 나온다. 앵커를 보기 전에 잘라야 한다.
    const model = modelWith([tbl('u1', null, 0, 0), tbl('a1', 'gA', 500, 100)], ['gA'])
    expect(planGroupMove(model, ['a1'], null)).toEqual([])
  })

  it('이동 대상은 대상 그룹의 기준 bbox에서 제외한다', () => {
    // 잘못된 호출을 흉내 낸 것이 아니라 **정상 시나리오**다 — 이미 대상 그룹(gB)에 속한 테이블이
    // 선택에 섞여 있는 경우다(여러 그룹에 걸친 선택을 그중 하나로 옮기면 UI에서 그대로 도달한다).
    // 이 필터가 planGroupMove의 실제 방어다. 빼면 a1이 자기 자신의 기준이 되어 이동 집합 전체가
    // 자기 오른쪽으로 밀린다 — 호출 순서를 지켜도 막지 못한다.
    const model = modelWith([tbl('b1', 'gB', 0, 0), tbl('a1', 'gB', 500, 100)], ['gB'])
    const moves = planGroupMove(model, ['a1'], 'gB')
    expect(moves).toEqual([{ id: 'a1', position: { x: 320, y: 0 } }])
  })

  it('모델에 없는 id는 조용히 무시한다', () => {
    const model = modelWith([tbl('b1', 'gB', 0, 0)], ['gB'])
    expect(planGroupMove(model, ['없는id'], 'gB')).toEqual([])
  })
})
