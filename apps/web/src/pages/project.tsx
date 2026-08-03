import { Link, useParams } from 'react-router'
import { ReactFlowProvider } from '@xyflow/react'
import { Settings } from 'lucide-react'
import { useModelLoader } from '@/editor/use-model'
import { useRealtime } from '@/editor/use-realtime'
import { PresenceBar } from '@/editor/presence'
import { useEditorStore } from '@/editor/store'
import { Canvas } from '@/editor/canvas'
import { CustomFieldPanel } from '@/editor/custom-field-panel'
import { DdlImportDialog } from '@/editor/ddl-import-dialog'
import { DictPanel } from '@/editor/dict-panel'
import { DomainPanel } from '@/editor/domain-panel'
import { EditPanel } from '@/editor/edit-panel'
import { ExportDialog } from '@/editor/export-dialog'
import { GroupViewSelect } from '@/editor/group-view-select'
import { NamingCheck } from '@/editor/naming-check'
import { ResourcePanel } from '@/editor/resource-panel'
import { TableTree } from '@/editor/table-tree'
import { Toolbar } from '@/editor/toolbar'
import { VersionDialog } from '@/editor/version-dialog'
import { ViewModeToggle } from '@/editor/view-mode-toggle'
import { BrandWordmark } from '@/components/brand-mark'
import { UserMenu } from '@/components/user-menu'
import { useMe } from '@/components/require-auth'
import { Button } from '@/components/ui/button'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const me = useMe()
  const load = useModelLoader(projectId)
  const loaded = useEditorStore((s) => s.loaded)
  useRealtime(projectId)

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
            {loaded && <PresenceBar selfUserId={me.id} />}
            {loaded && <GroupViewSelect />}
            {loaded && <VersionDialog projectId={projectId} />}
            {loaded && <DomainPanel projectId={projectId} />}
            {loaded && <DictPanel projectId={projectId} />}
            {loaded && <CustomFieldPanel projectId={projectId} />}
            {loaded && <ResourcePanel projectId={projectId} />}
            {loaded && <NamingCheck projectId={projectId} />}
            {loaded && <DdlImportDialog projectId={projectId} />}
            {loaded && <ExportDialog />}
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
                  <Canvas projectId={projectId} selfUserId={me.id} />
                  <EditPanel projectId={projectId} />
                </>
              )
            : <div className="flex flex-1 items-center justify-center text-muted-foreground">불러오는 중…</div>}
        </div>
      </ReactFlowProvider>
    </div>
  )
}
