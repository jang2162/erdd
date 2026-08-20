import { Link, useParams } from 'react-router'
import { ReactFlowProvider } from '@xyflow/react'
import { Settings } from 'lucide-react'
import { useModelLoader } from '@/editor/use-model'
import { useRealtime } from '@/editor/use-realtime'
import { useLocalWatch } from '@/editor/use-local-watch'
import { PresenceBar } from '@/editor/presence'
import { useEditorStore } from '@/editor/store'
import { BottomBar } from '@/editor/bottom-bar'
import { Canvas } from '@/editor/canvas'
import { DragGhost } from '@/editor/drag-ghost'
import { EditPanel } from '@/editor/edit-panel'
import { HeaderTools } from '@/editor/header-tools'
import { TableTree } from '@/editor/table-tree'
import { BrandWordmark } from '@/components/brand-mark'
import { UserMenu } from '@/components/user-menu'
import { useIsLocal, useMe } from '@/components/require-auth'
import { Button } from '@/components/ui/button'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const me = useMe()
  const isLocal = useIsLocal()
  const load = useModelLoader(projectId)
  const loaded = useEditorStore((s) => s.loaded)
  const blocked = useEditorStore((s) => s.blocked)
  // 로컬은 협업자가 없다 — 빈 projectId 면 useRealtime의 ready 가드(loadedProjectId === projectId)가
  // 절대 참이 되지 않아 소켓을 열지 않는다.
  useRealtime(isLocal ? '' : projectId)
  useLocalWatch(projectId, isLocal)

  if (load.isError) {
    return <p role="alert" className="p-8 text-destructive">{load.error.message}</p>
  }

  return (
    <div className="flex h-dvh flex-col">
      <ReactFlowProvider>
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
          <Link to="/" aria-label="홈으로"><BrandWordmark /></Link>
          <div className="flex items-center gap-2">
            {loaded && !isLocal && <PresenceBar selfUserId={me.id} />}
            {loaded && <HeaderTools projectId={projectId} />}
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/p/${projectId}/settings`}><Settings /> 설정</Link>
            </Button>
            {!isLocal && <UserMenu />}
          </div>
        </header>
        {blocked !== null && (
          <div role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            파일을 읽을 수 없어 편집이 잠겼습니다 — {blocked[0]!.path}: {blocked[0]!.message}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {loaded
            ? (
                <>
                  <TableTree projectId={projectId} />
                  <Canvas projectId={projectId} selfUserId={me.id} />
                  <EditPanel projectId={projectId} />
                </>
              )
            : <div className="flex flex-1 items-center justify-center text-muted-foreground">불러오는 중…</div>}
        </div>
        {loaded && <BottomBar projectId={projectId} />}
        {/* 드래그 고스트는 셸 루트에 하나만 둔다 — ReactFlow 뷰포트 안에 넣으면 캔버스 변환에 끌려간다. */}
        <DragGhost />
      </ReactFlowProvider>
    </div>
  )
}
