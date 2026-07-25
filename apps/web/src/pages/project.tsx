import { Link, useParams } from 'react-router'
import { ReactFlowProvider } from '@xyflow/react'
import { Settings } from 'lucide-react'
import { useModelLoader } from '@/editor/use-model'
import { useEditorStore } from '@/editor/store'
import { Canvas } from '@/editor/canvas'
import { EditPanel } from '@/editor/edit-panel'
import { GroupViewSelect } from '@/editor/group-view-select'
import { TableTree } from '@/editor/table-tree'
import { Toolbar } from '@/editor/toolbar'
import { ViewModeToggle } from '@/editor/view-mode-toggle'
import { BrandWordmark } from '@/components/brand-mark'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const load = useModelLoader(projectId)
  const loaded = useEditorStore((s) => s.loaded)

  if (load.isError) {
    return <p role="alert" className="p-8 text-destructive">{load.error.message}</p>
  }

  return (
    <div className="flex h-dvh flex-col">
      <ReactFlowProvider>
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
          <div className="flex items-center gap-4">
            <Link to="/" aria-label="홈으로"><BrandWordmark /></Link>
            {loaded && <Toolbar projectId={projectId} />}
          </div>
          <div className="flex items-center gap-2">
            {loaded && <GroupViewSelect />}
            <ViewModeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/p/${projectId}/settings`}><Settings /> 설정</Link>
            </Button>
            <UserMenu />
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          {loaded
            ? (
                <>
                  <TableTree projectId={projectId} />
                  <Canvas projectId={projectId} />
                  <EditPanel projectId={projectId} />
                </>
              )
            : <div className="flex flex-1 items-center justify-center text-muted-foreground">불러오는 중…</div>}
        </div>
      </ReactFlowProvider>
    </div>
  )
}
