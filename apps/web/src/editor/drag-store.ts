import { create } from 'zustand'
import type { DropTarget } from './drop-target.js'

/**
 * 드래그 중 상태. **에디터 store와 분리한다** — `over`는 `pointermove`마다 갱신되는데,
 * 에디터 store는 모델까지 들고 있어 구독자가 많다(캔버스 전체가 커서 움직임마다 리렌더된다).
 */
type DragState = {
  /** 끌고 있는 테이블. 빈 배열 = 드래그 중이 아님. */
  tableIds: string[]
  over: DropTarget | null
  start: (tableIds: readonly string[]) => void
  moveOver: (over: DropTarget | null) => void
  end: () => void
}

const IDLE = { tableIds: [] as string[], over: null }

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
  start: (tableIds) => set({ tableIds: [...tableIds], over: null }),
  moveOver: (over) => set((s) => (sameTarget(s.over, over) ? {} : { over })),
  end: () => set(IDLE),
}))
