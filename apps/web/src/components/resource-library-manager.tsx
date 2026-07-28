import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import {
  RESOURCE_KINDS, RESOURCE_KIND_LABEL, resourceDisplayName, type ResourceKind,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { ResourceItemForm, type DomainOption } from '@/components/resource-item-form'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ItemRow = { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }

/**
 * 전역(/admin)·조직(/org/:orgId) 공용 리소스 라이브러리 관리 화면.
 * 데이터 모델과 로직은 두 스코프가 완전히 같고 권한 판정만 서버에서 갈린다.
 */
export function ResourceLibraryManager({
  scope, orgId, canManage,
}: { scope: 'global' | 'org'; orgId?: string; canManage: boolean }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const listInput = scope === 'global' ? { scope } : { scope, orgId: orgId! }
  const libraries = useQuery(trpc.resource.library.list.queryOptions(listInput))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [editing, setEditing] = useState<{ kind: ResourceKind; item: ItemRow | null } | null>(null)

  const items = useQuery({
    ...trpc.resource.items.list.queryOptions({ libraryId: selectedId ?? '' }),
    enabled: selectedId !== null,
  })

  const invalidateLibraries = () =>
    queryClient.invalidateQueries({ queryKey: trpc.resource.library.list.queryKey(listInput) })
  const invalidateItems = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.resource.items.list.queryKey({ libraryId: selectedId ?? '' }),
    })
  const onError = (err: { message: string }) => toast.error(err.message)

  const createLibrary = useMutation(trpc.resource.library.create.mutationOptions({
    onSuccess: async () => {
      toast.success('라이브러리를 만들었습니다')
      setCreateOpen(false); setNewName(''); setNewDescription('')
      await invalidateLibraries()
    },
    onError,
  }))
  const removeLibrary = useMutation(trpc.resource.library.remove.mutationOptions({
    onSuccess: async () => { setSelectedId(null); await invalidateLibraries() }, onError,
  }))
  const createItem = useMutation(trpc.resource.items.create.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidateItems(); await invalidateLibraries() },
    onError,
  }))
  const updateItem = useMutation(trpc.resource.items.update.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidateItems() }, onError,
  }))
  const removeItem = useMutation(trpc.resource.items.remove.mutationOptions({
    onSuccess: async () => { await invalidateItems(); await invalidateLibraries() }, onError,
  }))

  const rows = (items.data ?? []) as ItemRow[]
  const domainOptions: DomainOption[] = rows
    .filter((r) => r.kind === 'domain')
    .map((r) => ({ id: r.id, name: resourceDisplayName('domain', r.payload) }))

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {scope === 'global' ? '전역 공용 리소스' : '조직 공용 리소스'}
        </h2>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> 라이브러리 만들기
          </Button>
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
          <li key={lib.id} className="rounded-md border">
            <div className="flex items-center justify-between gap-2 p-3">
              <button type="button" className="grid flex-1 gap-0.5 text-left"
                onClick={() => setSelectedId(selectedId === lib.id ? null : lib.id)}>
                <span className="font-medium">{lib.name}</span>
                <span className="text-xs text-muted-foreground">
                  {lib.description || '설명 없음'} · 항목 {lib.itemCount}개
                </span>
              </button>
              {canManage && (
                <Button size="icon" variant="ghost" className="size-7 text-destructive"
                  aria-label={`${lib.name} 삭제`}
                  onClick={() => {
                    if (!window.confirm(`"${lib.name}"을(를) 삭제하면 항목 ${lib.itemCount}개도 함께 삭제됩니다. 계속할까요?`)) return
                    removeLibrary.mutate({ libraryId: lib.id })
                  }}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>

            {selectedId === lib.id && (
              <div className="grid gap-3 border-t p-3">
                {items.isError && (
                  <p role="alert" className="text-destructive">{items.error.message}</p>
                )}
                {RESOURCE_KINDS.map((kind) => {
                  const kindRows = rows.filter((r) => r.kind === kind)
                  return (
                    <div key={kind} className="grid gap-1.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-muted-foreground">
                          {RESOURCE_KIND_LABEL[kind]}
                        </h3>
                        {canManage && (
                          <Button size="sm" variant="ghost"
                            onClick={() => setEditing({ kind, item: null })}>
                            <Plus className="size-3" /> 추가
                          </Button>
                        )}
                      </div>
                      {kindRows.length === 0 && (
                        <p className="text-xs text-muted-foreground">없음</p>
                      )}
                      <ul className="grid gap-1">
                        {kindRows.map((row) => {
                          const name = resourceDisplayName(kind, row.payload)
                          return (
                            <li key={row.id}
                              className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm">
                              <span>{name}</span>
                              <span className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">v{row.version}</span>
                                {canManage && (
                                  <>
                                    <Button size="icon" variant="ghost" className="size-6"
                                      aria-label={`${name} 편집`}
                                      onClick={() => setEditing({ kind, item: row })}>
                                      <Pencil className="size-3" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="size-6 text-destructive"
                                      aria-label={`${name} 삭제`}
                                      onClick={() => {
                                        if (!window.confirm(`"${name}"을(를) 삭제할까요? 이미 가져간 프로젝트의 사본은 그대로 남습니다.`)) return
                                        removeItem.mutate({ itemId: row.id })
                                      }}>
                                      <Trash2 className="size-3" />
                                    </Button>
                                  </>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
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

      {editing && selectedId && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditing(null) }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {RESOURCE_KIND_LABEL[editing.kind]} {editing.item ? '수정' : '추가'}
              </DialogTitle>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto">
              <ResourceItemForm
                key={editing.item?.id ?? `new-${editing.kind}`}
                kind={editing.kind}
                payload={editing.item?.payload ?? null}
                domainOptions={domainOptions}
                onCancel={() => setEditing(null)}
                onSubmit={(payload) => {
                  if (editing.item) updateItem.mutate({ itemId: editing.item.id, payload })
                  else createItem.mutate({ libraryId: selectedId, kind: editing.kind, payload })
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
