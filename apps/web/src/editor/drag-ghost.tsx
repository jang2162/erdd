import { useEffect, useRef } from 'react'
import { useDragStore } from './drag-store.js'

/** 커서에서 살짝 비켜 그린다 — 커서 바로 밑에 겹치면 무엇을 조준하는지 가려진다. */
const OFFSET = 12

/**
 * 드래그 중 커서를 따라다니는 고스트(설계 5.3). 무엇을 몇 개 끌고 있는지 보여 주는 유일한 표시다.
 *
 * **에디터 셸 루트에 하나만 마운트한다.** 항목마다 만들면 드래그 소스 수만큼 겹쳐 그려진다.
 *
 * ⚠️ **`pointer-events: none`이 이 구현의 유일한 치명적 함정이다.** 드롭 타깃 판정은
 * `document.elementFromPoint(x, y)`인데, 커서 자리에 `position: fixed` 고스트가 있으면
 * **항상 고스트**가 반환되고 `closest('[data-drop-group]')`가 null이 되어 **드롭이 통째로 죽는다.**
 * 오프셋만으로는 부족하다 — 빠르게 움직이면 커서와 겹친다. 그래서 클래스가 아니라 **인라인 style**로
 * 건다: jsdom에는 Tailwind CSS가 없어 클래스로 걸면 테스트가 이 계약을 확인할 방법이 없다.
 * (실제 히트 테스트 자체는 jsdom에 레이아웃이 없어 검증 불가 — 브라우저 스모크가 유일한 그물이다.)
 *
 * 위치 갱신은 **React state를 거치지 않는다.** `pointermove`마다 리렌더하면 사이드바 전체가
 * 커서 한 픽셀마다 다시 그려져 드래그 상태를 별도 store로 뺀 취지(설계 5.2)가 무너진다.
 * 자기 DOM의 `style.transform`만 직접 쓴다.
 */
export function DragGhost() {
  const count = useDragStore((s) => s.tableIds.length)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (count === 0) return
    const onMove = (e: PointerEvent) => {
      const el = ref.current
      if (el) el.style.transform = `translate(${e.clientX + OFFSET}px, ${e.clientY + OFFSET}px)`
    }
    window.addEventListener('pointermove', onMove)
    return () => { window.removeEventListener('pointermove', onMove) }
  }, [count])

  if (count === 0) return null

  return (
    <div ref={ref} aria-hidden data-testid="drag-ghost"
      className="fixed left-0 top-0 z-50 rounded border bg-popover px-2 py-1 text-xs
        font-medium text-popover-foreground shadow-md"
      // 첫 pointermove가 자리를 잡을 때까지 화면 밖에 둔다 — 좌상단(0,0)에 한 프레임 번쩍이지 않게.
      style={{ pointerEvents: 'none', transform: 'translate(-9999px, -9999px)' }}>
      {count}개 테이블
    </div>
  )
}
