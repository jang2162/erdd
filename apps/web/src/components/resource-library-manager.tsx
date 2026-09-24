import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileUp, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { LIBRARY_FILE_EXTENSION } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCount } from '@/lib/format'
import { libraryDomainsQueryKey } from '@/lib/library-domains'
import { LibraryImportDialog, type LibraryImportTarget } from '@/components/library-import-dialog'
import { LibraryViewDialog } from '@/components/library-view-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 전역(/admin)·조직(/org/:orgId) 공용 리소스 라이브러리 관리 화면.
 * 데이터 모델과 로직은 두 스코프가 완전히 같고 권한 판정만 서버에서 갈린다.
 * 라이브러리 행을 누르면 조회 모달(`LibraryViewDialog`)이 열린다 — 항목은 그 모달이 페이지 단위로 받는다.
 */
export function ResourceLibraryManager({
  scope, orgId, canManage,
}: { scope: 'global' | 'org'; orgId?: string; canManage: boolean }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const listInput = scope === 'global' ? { scope } : { scope, orgId: orgId! }
  const libraries = useQuery(trpc.resource.library.list.queryOptions(listInput))
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [importTarget, setImportTarget] = useState<LibraryImportTarget | null>(null)

  const invalidateLibraries = () =>
    queryClient.invalidateQueries({ queryKey: trpc.resource.library.list.queryKey(listInput) })
  const invalidateItems = (libraryId: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.resource.items.page.queryKey({ libraryId }) }),
    queryClient.invalidateQueries({ queryKey: libraryDomainsQueryKey(libraryId) }),
  ])
  const onError = (err: { message: string }) => toast.error(err.message)

  /** 배포 파일을 내려받는다 — 읽을 수 있으면 누구나(배포 목적). */
  const onExport = async (lib: { id: string; name: string }) => {
    try {
      const res = await queryClient.fetchQuery(trpc.resource.library.export.queryOptions({ libraryId: lib.id }))
      const url = URL.createObjectURL(new Blob([res.text], { type: 'application/yaml' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${lib.name.replace(/[\\/:*?"<>|]/g, '_')}${LIBRARY_FILE_EXTENSION}`
      a.click()
      URL.revokeObjectURL(url)
      if (res.danglingDomainRefs > 0) {
        toast.info(`삭제된 도메인을 가리키던 용어 ${formatCount(res.danglingDomainRefs)}건은 도메인 없이 내보냈습니다`)
      }
    } catch (err) { onError(err as { message: string }) }
  }

  const createLibrary = useMutation(trpc.resource.library.create.mutationOptions({
    onSuccess: async () => {
      toast.success('라이브러리를 만들었습니다')
      setCreateOpen(false); setNewName(''); setNewDescription('')
      await invalidateLibraries()
    },
    onError,
  }))
  const removeLibrary = useMutation(trpc.resource.library.remove.mutationOptions({
    onSuccess: async (_data, variables) => {
      if (viewingId === variables.libraryId) setViewingId(null)
      await invalidateLibraries()
    },
    onError,
  }))

  const viewing = libraries.data?.find((lib) => lib.id === viewingId) ?? null

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {scope === 'global' ? '전역 공용 리소스' : '조직 공용 리소스'}
        </h2>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> 라이브러리 만들기
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportTarget(scope === 'global' ? { kind: 'create', scope } : { kind: 'create', scope, orgId: orgId! })}>
              <FileUp /> 파일에서 만들기
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        프로젝트에서 "공용 리소스" 화면으로 가져가 쓰는 표준 단어·용어·도메인·커스텀 항목입니다.
      </p>

      {libraries.isError && <p role="alert" className="text-destructive">{libraries.error.message}</p>}
      {libraries.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">아직 라이브러리가 없습니다</p>
      )}

      <ul className="grid gap-2">
        {libraries.data?.map((lib) => (
          <li key={lib.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
            <button type="button" className="grid flex-1 gap-0.5 text-left" onClick={() => setViewingId(lib.id)}>
              <span className="font-medium">{lib.name}</span>
              <span className="text-xs text-muted-foreground">
                {lib.description || '설명 없음'} · 항목 {formatCount(lib.itemCount)}개
              </span>
            </button>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`${lib.name} 내보내기`} onClick={() => void onExport(lib)}>
              <Download className="size-4" />
            </Button>
            {canManage && (
              <Button size="icon" variant="ghost" className="size-7" aria-label={`${lib.name} 가져오기`}
                onClick={() => setImportTarget({ kind: 'existing', libraryId: lib.id, name: lib.name })}>
                <Upload className="size-4" />
              </Button>
            )}
            {canManage && (
              <Button size="icon" variant="ghost" className="size-7 text-destructive"
                aria-label={`${lib.name} 삭제`}
                onClick={() => {
                  if (!window.confirm(`"${lib.name}"을(를) 삭제하면 항목 ${formatCount(lib.itemCount)}개도 함께 삭제됩니다. 계속할까요?`)) return
                  removeLibrary.mutate({ libraryId: lib.id })
                }}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>라이브러리 만들기</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rl-name">이름</Label>
              <Input id="rl-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rl-desc">설명 (선택)</Label>
              <Input id="rl-desc" value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" disabled={newName.trim() === '' || createLibrary.isPending}
              onClick={() => createLibrary.mutate(
                scope === 'global'
                  ? { scope, name: newName.trim(), description: newDescription.trim() }
                  : { scope, orgId: orgId!, name: newName.trim(), description: newDescription.trim() },
              )}>
              만들기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewing && (
        <LibraryViewDialog library={viewing} canManage={canManage}
          onClose={() => setViewingId(null)} onChanged={invalidateLibraries} />
      )}

      {importTarget && (
        <LibraryImportDialog target={importTarget} onClose={() => setImportTarget(null)}
          onDone={() => {
            setImportTarget(null)
            void invalidateLibraries()
            if (importTarget.kind === 'existing') void invalidateItems(importTarget.libraryId)
          }} />
      )}
    </section>
  )
}
