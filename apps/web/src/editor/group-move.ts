import type { Position, ProjectModel, Table } from '@erdd/core'

/** 테이블 노드 폭 추정치. 실측 bbox가 없어 렌더 상수를 쓴다(`tableBounds`가 쓴다). */
const EST_W = 260
/** 그룹 영역이 멤버 bbox 바깥으로 두는 여백. */
export const GROUP_PAD = 28
/** 대상 그룹과 새로 들어오는 테이블 사이 간격. */
const GAP = 60

function estHeight(colCount: number): number {
  return 44 + Math.max(1, colCount) * 28
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** 테이블 목록이 차지하는 사각형. 빈 목록이면 null. */
export function tableBounds(model: ProjectModel, tables: readonly Table[]): Bounds | null {
  if (tables.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const t of tables) {
    const cols = Object.values(model.columns).filter((c) => c.tableId === t.id).length
    minX = Math.min(minX, t.position.x)
    minY = Math.min(minY, t.position.y)
    maxX = Math.max(maxX, t.position.x + EST_W)
    maxY = Math.max(maxY, t.position.y + estHeight(cols))
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 그룹을 옮긴 테이블들의 새 좌표. 상대 배치를 유지한 채 대상 그룹 영역 오른쪽으로 평행이동한다.
 *
 * 좌표를 건드리지 않는 두 경우는 **빈 배열**을 반환한다 — 대상이 미분류이거나, 대상 그룹에 기존
 * 멤버가 없을 때다. 기준으로 삼을 영역이 없는데 억지로 옮기면 결과가 예측 불가능해진다.
 *
 * ⚠️ 정확성을 지탱하는 것은 아래 `movingIds` 필터다 — 이동 집합을 기준 bbox에서 **스스로 제외**한다.
 * 그래서 **호출 순서에 무관하다**(그룹 변경 전 모델을 넘기든 후를 넘기든 반환값이 같다). 필터가 막는
 * 것은 잘못된 호출이 아니라 **정상 시나리오**다 — 여러 그룹에 걸친 선택을 그중 일부가 이미 속한
 * 그룹으로 옮길 때, 그 테이블이 자기 자신의 기준이 되는 것을 막는다. 변경 전 모델을 넘기는 것은
 * 읽기 좋음의 관례일 뿐 정확성 요건이 아니다.
 *
 * 계산하는 것은 언제나 **전체 뷰 좌표(`position`)**다. 그룹 뷰에서 드롭해도 마찬가지다 — 그 테이블은
 * 다른 그룹 소속이 되어 현재 뷰에서 사라지므로, 재배치 결과는 전체 뷰로 나가야 보인다.
 */
export function planGroupMove(
  model: ProjectModel, tableIds: readonly string[], targetGroupId: string | null,
): { id: string; position: Position }[] {
  if (targetGroupId === null) return []
  const moving = tableIds.map((id) => model.tables[id]).filter((t): t is Table => t !== undefined)
  if (moving.length === 0) return []

  const movingIds = new Set(moving.map((t) => t.id))
  const anchors = Object.values(model.tables)
    .filter((t) => t.groupId === targetGroupId && !movingIds.has(t.id))
  const target = tableBounds(model, anchors)
  if (target === null) return []

  const src = tableBounds(model, moving)!
  const dx = target.maxX + GAP - src.minX
  const dy = target.minY - src.minY
  return moving.map((t) => ({ id: t.id, position: { x: t.position.x + dx, y: t.position.y + dy } }))
}
