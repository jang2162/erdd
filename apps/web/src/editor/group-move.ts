import type { Position, ProjectModel, Table } from '@erdd/core'

/** 테이블 노드 폭 추정치. 실측 bbox가 없어 렌더 상수를 쓴다(`tableBounds`가 쓴다). */
const EST_W = 260
/** 그룹 영역이 멤버 bbox 바깥으로 두는 여백. */
export const GROUP_PAD = 28
/**
 * 대상 그룹과 새로 들어오는 테이블 사이 간격이자, 재배치 결과가 **다른 테이블에서 떨어져 있어야 할
 * 최소 거리**다. 둘을 같은 값으로 두는 것은 우연이 아니다 — 이 값이 `GROUP_PAD * 2`(56)보다 크므로
 * 테이블끼리 겹치지 않는 것을 넘어 **그룹 색상 영역끼리도 겹치지 않는다**.
 */
const GAP = 60

function estHeight(colCount: number): number {
  return 44 + Math.max(1, colCount) * 28
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * 테이블별 컬럼 수. **컬럼 전체를 한 번만** 훑는다.
 *
 * ⚠️ 테이블마다 `model.columns`를 filter하면 O(테이블 × 컬럼)이 된다 — 2,000테이블/3만컬럼에서
 * 드롭 1회가 수백 ms다(최종 리뷰 실측). 겹침 회피는 **이동 대상이 아닌 테이블 전부**의 높이를
 * 알아야 하므로 그 비용이 그대로 곱해진다. 그래서 계수를 한 번 만들어 돌려 쓴다.
 */
function columnCounts(model: ProjectModel): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of Object.values(model.columns)) {
    counts.set(c.tableId, (counts.get(c.tableId) ?? 0) + 1)
  }
  return counts
}

function tableRect(t: Table, counts: ReadonlyMap<string, number>): Bounds {
  return {
    minX: t.position.x,
    minY: t.position.y,
    maxX: t.position.x + EST_W,
    maxY: t.position.y + estHeight(counts.get(t.id) ?? 0),
  }
}

/**
 * 테이블 목록이 차지하는 사각형. 빈 목록이면 null.
 *
 * `counts`를 넘기면 컬럼 스캔을 건너뛴다. 여러 번 부를 곳(그룹마다 부르는 `buildGroupNodes`,
 * 겹침 회피)은 `columnCounts`를 한 번 만들어 넘겨야 O(테이블 × 컬럼)을 피한다.
 */
export function tableBounds(
  model: ProjectModel, tables: readonly Table[], counts?: ReadonlyMap<string, number>,
): Bounds | null {
  if (tables.length === 0) return null
  const cnt = counts ?? columnCounts(model)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const t of tables) {
    const r = tableRect(t, cnt)
    minX = Math.min(minX, r.minX)
    minY = Math.min(minY, r.minY)
    maxX = Math.max(maxX, r.maxX)
    maxY = Math.max(maxY, r.maxY)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 이동 집합을 `x = left`, `y = topFrom`에 놓았을 때 **다른 테이블과 GAP 안으로 붙지 않는** 첫 y.
 *
 * 아래로만 민다. x는 `대상 그룹 bbox 오른쪽 + GAP`으로 고정이므로 옆으로 밀면 "그룹 옆에 붙인다"는
 * 배치 의도(설계 D3)가 무너진다 — 아래로 미는 것은 그 의도를 지킨 채 자리만 비켜 준다.
 *
 * 이동 집합은 **bbox 하나로** 다룬다. 개별 테이블 대신 감싸는 사각형을 쓰므로 결과가 보수적일 수는
 * 있어도(집합 내부 빈 공간에 남의 테이블이 들어갈 자리를 안 준다) 겹침이 남지는 않는다. 그리고
 * 집합 전체가 같은 delta로 움직이므로 **상대 배치가 그대로 보존된다.**
 *
 * 규모: 후보 x 띠에 걸치는 장애물만 `band`로 추리고(테이블 1회 순회) 그 안에서만 세로로 훑는다.
 * `top`은 장애물의 `maxY + GAP` 값만 취하며 **단조 증가**하므로 패스는 최대 `band.length`번이다.
 */
function firstFreeTop(band: readonly Bounds[], topFrom: number, height: number): number {
  let top = topFrom
  for (let pass = 0; pass <= band.length; pass++) {
    let pushed = false
    for (const b of band) {
      if (top < b.maxY + GAP && b.minY < top + height + GAP) {
        top = b.maxY + GAP
        pushed = true
      }
    }
    if (!pushed) break
  }
  return top
}

/**
 * 그룹을 옮긴 테이블들의 새 좌표. 상대 배치를 유지한 채 대상 그룹 영역 오른쪽으로 평행이동하되,
 * 그 자리가 **이미 다른 테이블이 쓰고 있으면 비어 있는 곳까지 아래로 민다.**
 *
 * 겹침 회피가 없으면 "대상 그룹 오른쪽"이 그룹 **밖** 테이블의 자리와 정확히 겹칠 수 있다. 겹친
 * 노드는 완전히 가려져 사용자에게는 테이블이 사라진 것처럼 보인다(사이드바에는 남아 있어 더
 * 헷갈린다). 브라우저 스모크가 실제로 잡았다 — 대상 그룹 bbox의 `maxX + GAP`에 미분류 테이블이
 * 앉아 있으면 좌표가 한 픽셀도 어긋나지 않고 일치한다.
 *
 * 좌표를 건드리지 않는 두 경우는 **빈 배열**을 반환한다 — 대상이 미분류이거나, 대상 그룹에 기존
 * 멤버가 없을 때다. 기준으로 삼을 영역이 없는데 억지로 옮기면 결과가 예측 불가능해진다.
 *
 * ⚠️ 정확성을 지탱하는 것은 아래 `movingIds` 필터다 — 이동 집합을 기준 bbox에서 **스스로 제외**한다.
 * 그래서 **호출 순서에 무관하다**(그룹 변경 전 모델을 넘기든 후를 넘기든 반환값이 같다). 필터가 막는
 * 것은 잘못된 호출이 아니라 **정상 시나리오**다 — 여러 그룹에 걸친 선택을 그중 일부가 이미 속한
 * 그룹으로 옮길 때, 그 테이블이 자기 자신의 기준이 되는 것을 막는다. 같은 이유로 겹침 회피의
 * 장애물 목록에서도 이동 집합을 뺀다 — 안 빼면 자기 자신을 피하느라 무한정 아래로 내려간다.
 * 변경 전 모델을 넘기는 것은 읽기 좋음의 관례일 뿐 정확성 요건이 아니다.
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
  const counts = columnCounts(model)
  const anchors = Object.values(model.tables)
    .filter((t) => t.groupId === targetGroupId && !movingIds.has(t.id))
  const target = tableBounds(model, anchors, counts)
  if (target === null) return []

  const src = tableBounds(model, moving, counts)!
  const dx = target.maxX + GAP - src.minX
  const left = src.minX + dx
  const right = src.maxX + dx

  // 세로로만 미므로 x 띠가 겹치지 않는 테이블은 영원히 장애물이 아니다 — 먼저 걸러 낸다.
  // 앵커는 정의상 `maxX <= target.maxX = left - GAP`이라 이 필터를 통과하지 못한다(경계는 여유
  // 간격을 정확히 채운 상태이므로 겹침이 아니다).
  const band: Bounds[] = []
  for (const t of Object.values(model.tables)) {
    if (movingIds.has(t.id)) continue
    const r = tableRect(t, counts)
    if (r.minX < right + GAP && left < r.maxX + GAP) band.push(r)
  }
  band.sort((a, b) => a.minY - b.minY)

  const top = firstFreeTop(band, target.minY, src.maxY - src.minY)
  const dy = top - src.minY
  return moving.map((t) => ({ id: t.id, position: { x: t.position.x + dx, y: t.position.y + dy } }))
}
