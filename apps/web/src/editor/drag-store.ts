import { create } from 'zustand'
import type { DropTarget } from './drop-target.js'

/**
 * 드래그를 시작한 곳. **커서 고스트가 이 값으로 갈린다** — 고스트는 끌고 있는 것이 화면에 달리
 * 보이지 않는 사이드바 드래그 전용 표시이고, 캔버스에서는 ReactFlow가 노드 자체를 끌고 다녀
 * 고스트가 겹치면 무엇을 조준하는지 오히려 가려진다(설계 5.3·5.4).
 *
 * `tableIds`·`over`로는 두 소스를 구분할 수 없다 — 둘 다 같은 모양이다. 그래서 시작할 때
 * 명시적으로 남기고, 인자를 **필수**로 두어 새 드래그 소스가 조용히 고스트를 켜지 못하게 한다.
 */
export type DragSource = 'sidebar' | 'canvas'

/**
 * 드래그 중 상태. **에디터 store와 분리한다** — `over`는 `pointermove`마다 갱신되는데,
 * 에디터 store는 모델까지 들고 있어 구독자가 많다(캔버스 전체가 커서 움직임마다 리렌더된다).
 */
type DragState = {
  /** 끌고 있는 테이블. 빈 배열 = 드래그 중이 아님. */
  tableIds: string[]
  /** 드래그를 시작한 곳. null = 드래그 중이 아님. */
  source: DragSource | null
  over: DropTarget | null
  start: (tableIds: readonly string[], source: DragSource) => void
  moveOver: (over: DropTarget | null) => void
  end: () => void
}

const IDLE = { tableIds: [] as string[], source: null, over: null }

/**
 * 타깃이 그대로면 **같은 참조**를 유지한다. `pointermove`마다 새 객체를 넣으면 `over`를 구독하는
 * 컴포넌트가 커서 한 픽셀마다 리렌더된다(zustand는 partial이 `{}`여도 루트 상태를 새로 만들지만,
 * 셀렉터 구독은 선택된 값의 참조가 같으면 리렌더를 건너뛴다).
 */
function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b
  return a.groupId === b.groupId
}

export const useDragStore = create<DragState>((set) => ({
  ...IDLE,
  start: (tableIds, source) => set({ tableIds: [...tableIds], source, over: null }),
  moveOver: (over) => set((s) => (sameTarget(s.over, over) ? {} : { over })),
  end: () => set(IDLE),
}))
