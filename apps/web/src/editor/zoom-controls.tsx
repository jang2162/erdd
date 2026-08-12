import { Maximize, Minus, Plus } from 'lucide-react'
import { useReactFlow, useStore } from '@xyflow/react'
import { Button } from '@/components/ui/button'

/**
 * 하단 바의 줌 컨트롤. React Flow 기본 `<Controls>`를 대신한다 — 전체 폭 하단 바를 깔면 캔버스
 * 좌하단의 기본 컨트롤이 그 위에 겹쳐 "두 겹 툴바"가 되기 때문이다(설계 D4).
 *
 * 뷰 조작이지 편집이 아니므로 읽기 전용에서도 그대로 동작한다.
 */
export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])

  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon-sm" variant="ghost" aria-label="축소" onClick={() => zoomOut()}>
        <Minus className="size-4" />
      </Button>
      <Button size="sm" variant="ghost" className="w-14 px-0 text-xs tabular-nums"
        aria-label="배율 100%로" onClick={() => zoomTo(1)}>
        {`${Math.round(zoom * 100)}%`}
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="확대" onClick={() => zoomIn()}>
        <Plus className="size-4" />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="화면에 맞춤" onClick={() => fitView()}>
        <Maximize className="size-4" />
      </Button>
    </div>
  )
}
