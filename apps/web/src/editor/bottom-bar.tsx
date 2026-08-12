import { Toolbar } from './toolbar.js'
import { GroupViewSelect } from './group-view-select.js'
import { ViewModeToggle } from './view-mode-toggle.js'
import { ZoomControls } from './zoom-controls.js'

/**
 * 화면 전체 폭 하단 바. 캔버스를 직접 조작하는 것(편집 도구)과 캔버스를 어떻게 볼지 정하는
 * 것(그룹 뷰·표시 모드·줌)을 모은다. 관리 도구는 상단에 남는다(설계 D1·D3).
 *
 * 그룹 뷰·표시 모드는 좌측 트리·우측 편집 패널의 표시에도 걸리는 전역 상태라, 캔버스 열 안이
 * 아니라 전체 폭에 둔다.
 */
export function BottomBar({ projectId }: { projectId: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-card px-4">
      <Toolbar projectId={projectId} />
      <div className="mx-1 h-5 w-px bg-border" />
      <GroupViewSelect />
      <ViewModeToggle />
      <div className="ml-auto">
        <ZoomControls />
      </div>
    </div>
  )
}
