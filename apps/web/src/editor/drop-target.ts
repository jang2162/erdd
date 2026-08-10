/** groupId === null 은 "미분류"다. */
export type DropTarget = { groupId: string | null }

const ATTR = 'data-drop-group'
const UNASSIGNED = 'unassigned'

/**
 * DOM 엘리먼트에서 드롭 타깃을 읽는다. 좌표 조회(`dropTargetAt`)와 분리해 둔 이유는 jsdom에
 * 레이아웃이 없어 `elementFromPoint`가 **항상 null**이기 때문이다 — 판정 규칙은 이 함수로 테스트하고,
 * 좌표 조회는 얇은 래퍼로 남긴다. 둘을 합치면 드롭 판정이 통째로 미검증이 된다.
 */
export function dropTargetOf(el: Element | null): DropTarget | null {
  const host = el?.closest(`[${ATTR}]`)
  if (!host) return null
  // 속성 선택자는 값이 아니라 존재로 매칭한다 — 빈 값을 걸러 내지 않으면 groupId: '' 가 나간다.
  const raw = host.getAttribute(ATTR)
  if (raw === null || raw === '') return null
  return { groupId: raw === UNASSIGNED ? null : raw }
}

/** 화면 좌표 → 드롭 타깃. 사이드바 드래그와 캔버스 드래그가 이 한 함수로 수렴한다. */
export function dropTargetAt(x: number, y: number): DropTarget | null {
  return dropTargetOf(document.elementFromPoint(x, y))
}

/** 사이드바 그룹 블록이 다는 속성값. 미분류는 특수값이 필요하다 — null을 속성에 담을 수 없다. */
export function dropAttrValue(groupId: string | null): string {
  return groupId ?? UNASSIGNED
}
