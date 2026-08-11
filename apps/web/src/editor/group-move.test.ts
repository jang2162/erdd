import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Position, type ProjectModel, type Table } from '@erdd/core'
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

/**
 * 재배치 결과가 **이동 대상이 아닌** 테이블과 겹치는 쌍. 좌표를 고정 단언하는 것과 별개로 이것을
 * 함께 본다 — "겹치지 않는다"가 규칙이고 특정 좌표는 그 규칙의 한 결과일 뿐이다.
 *
 * `tbl`이 만드는 테이블은 컬럼이 0개이므로 사각형은 언제나 위치 + (260, 72)다.
 */
function overlappingPairs(model: ProjectModel, moves: { id: string; position: Position }[]): string[] {
  const movingIds = new Set(moves.map((m) => m.id))
  const others = Object.values(model.tables).filter((t) => !movingIds.has(t.id))
  const pairs: string[] = []
  for (const mv of moves) {
    const a = { x1: mv.position.x, y1: mv.position.y, x2: mv.position.x + 260, y2: mv.position.y + 72 }
    for (const o of others) {
      const b = { x1: o.position.x, y1: o.position.y, x2: o.position.x + 260, y2: o.position.y + 72 }
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) pairs.push(`${mv.id}↔${o.id}`)
    }
  }
  return pairs
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

  it('대상 그룹 오른쪽이 이미 차 있으면 겹치지 않는 자리까지 아래로 민다', () => {
    // 브라우저 스모크가 잡은 최소 재현이다(2026-08-11). 그룹 밖 테이블이 `대상 그룹 maxX + GAP`에
    // 정확히 앉아 있으면 옮긴 테이블이 그 위에 **한 픽셀도 어긋나지 않고** 포개졌다. 겹친 노드는
    // 완전히 가려져 사용자에게는 테이블이 사라진 것처럼 보인다.
    //
    // 주문 그룹 bbox maxX = 680 + 260 = 940 → 붙일 자리 x = 940 + GAP(60) = 1000.
    // 그 자리에 미분류 `audit_logs`가 이미 있다 → (1000,0)-(1260,72).
    // 아래로 밀어 y = 72 + GAP(60) = 132.
    const model = modelWith([
      tbl('orders', 'gOrder', 0, 0), tbl('order_items', 'gOrder', 340, 0),
      tbl('payments', 'gOrder', 680, 0),
      tbl('audit_logs', null, 1000, 0),
      tbl('settings', null, 0, 500),
    ], ['gOrder'])
    const moves = planGroupMove(model, ['settings'], 'gOrder')
    expect(moves).toEqual([{ id: 'settings', position: { x: 1000, y: 132 } }])
    expect(overlappingPairs(model, moves)).toEqual([])
  })

  it('아래로 밀려도 이동 집합의 상대 배치는 그대로다', () => {
    // 겹침 회피가 집합을 **통째로** 움직인다는 것을 잠근다. 테이블마다 따로 자리를 찾으면
    // 겹침은 사라지지만 D3의 "함께 옮긴 것은 함께 놓인다"가 깨진다.
    const model = modelWith([
      tbl('b1', 'gB', 0, 0), tbl('막는놈', null, 320, 0),
      tbl('a1', 'gA', 500, 100), tbl('a2', 'gA', 600, 200),
    ], ['gA', 'gB'])
    const moves = planGroupMove(model, ['a1', 'a2'], 'gB')
    expect(moves).toEqual([
      { id: 'a1', position: { x: 320, y: 132 } },
      { id: 'a2', position: { x: 420, y: 232 } },
    ])
    const [m1, m2] = moves
    expect(m2!.position.x - m1!.position.x).toBe(100)
    expect(m2!.position.y - m1!.position.y).toBe(100)
    expect(overlappingPairs(model, moves)).toEqual([])
  })

  it('장애물이 연달아 쌓여 있으면 마지막 것 아래까지 내려간다', () => {
    // 한 번만 밀면 두 번째 장애물 위에 얹힌다 — 빈자리를 찾을 때까지 반복해야 한다.
    const model = modelWith([
      tbl('b1', 'gB', 0, 0), tbl('막는놈1', null, 320, 0), tbl('막는놈2', null, 320, 132),
      tbl('a1', 'gA', 1000, 1000),
    ], ['gA', 'gB'])
    const moves = planGroupMove(model, ['a1'], 'gB')
    expect(moves).toEqual([{ id: 'a1', position: { x: 320, y: 264 } }])
    expect(overlappingPairs(model, moves)).toEqual([])
  })

  it('이동 대상 자신은 피해야 할 장애물이 아니다', () => {
    // 이미 목적지에 서 있는 테이블을 옮기면(다른 그룹에서 오는 정상 경로다) 좌표가 그대로여야 한다.
    // 장애물 목록에서 이동 집합을 빼지 않으면 **자기 자신을 피하느라** 근거 없이 아래로 내려간다.
    const model = modelWith([tbl('b1', 'gB', 0, 0), tbl('a1', 'gA', 320, 0)], ['gA', 'gB'])
    expect(planGroupMove(model, ['a1'], 'gB')).toEqual([{ id: 'a1', position: { x: 320, y: 0 } }])
  })
})
