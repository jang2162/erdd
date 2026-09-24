import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { formatCount, formatCreatedAt } from '@/lib/format'
import { useEditorStore } from './store.js'
import { HistoryView } from './history-view.js'
import { SnapshotDiff } from './snapshot-diff.js'
import { ChangesSection } from './changes-section.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useIsLocal } from '@/components/require-auth'

type Section = 'snapshot' | 'history' | 'diff' | 'changes'

/** 스냅샷 목록의 한 항목: 이름/설명/리비전/생성일 + 복원·삭제. 클릭하면 snapshot.get으로 요약을 펼쳐 보여준다(열람). */
function SnapshotRow({
  projectId, item, onRestored,
}: {
  projectId: string
  item: { id: string; name: string; description: string; revisionSeq: number; createdAt: string | Date }
  onRestored: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const setLoaded = useEditorStore((s) => s.setLoaded)
  const canManage = useEditorStore((s) => s.canManage)
  const [expanded, setExpanded] = useState(false)

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: trpc.snapshot.list.queryKey({ projectId }) })

  const detail = useQuery(
    trpc.snapshot.get.queryOptions({ projectId, snapshotId: item.id }, { enabled: expanded }),
  )

  const restore = useMutation(
    trpc.snapshot.restore.mutationOptions({
      onSuccess: async () => {
        const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
        setLoaded(fresh.model, fresh.seq, projectId)
        toast.success('스냅샷을 복원했습니다')
        onRestored()
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  const del = useMutation(
    trpc.snapshot.delete.mutationOptions({
      onSuccess: async () => { toast.success('스냅샷을 삭제했습니다'); await invalidateList() },
      onError: (err) => toast.error(err.message),
    }),
  )

  const onRestore = () => {
    if (!window.confirm(`"${item.name}" 스냅샷으로 복원할까요? 현재 편집 중인 내용이 대체됩니다.`)) return
    restore.mutate({ projectId, snapshotId: item.id })
  }
  const onDelete = () => {
    if (!window.confirm(`"${item.name}" 스냅샷을 삭제할까요?`)) return
    del.mutate({ projectId, snapshotId: item.id })
  }

  const tables = detail.data ? Object.values(detail.data.model.tables) : []

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="grid flex-1 gap-0.5 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className="font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">
            {item.description || '설명 없음'} · rev {item.revisionSeq} · {formatCreatedAt(item.createdAt)}
          </span>
        </button>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="outline" disabled={restore.isPending} onClick={onRestore}>
              복원
            </Button>
            <Button
              type="button" size="sm" variant="outline" className="text-destructive"
              disabled={del.isPending} onClick={onDelete}
            >
              삭제
            </Button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="mt-2 rounded-md bg-muted p-2 text-xs">
          {detail.isLoading && <p>불러오는 중…</p>}
          {detail.isError && <p className="text-destructive">{detail.error.message}</p>}
          {detail.data && (
            <>
              <p>테이블 {formatCount(tables.length)}개</p>
              {tables.length > 0 && (
                <p className="text-muted-foreground">
                  {tables.slice(0, 5).map((t) => t.physicalName).join(', ')}
                  {tables.length > 5 ? ' 외' : ''}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** "버전" 다이얼로그의 스냅샷 섹션: 생성/목록/열람/복원/삭제. */
function SnapshotSection({ projectId, onRestored }: { projectId: string; onRestored: () => void }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const canEdit = useEditorStore((s) => s.canEdit)
  const [name, setName] = useState('')
  const list = useQuery(trpc.snapshot.list.queryOptions({ projectId }))

  const create = useMutation(
    trpc.snapshot.create.mutationOptions({
      onSuccess: async () => {
        toast.success('스냅샷을 만들었습니다')
        setName('')
        await queryClient.invalidateQueries({ queryKey: trpc.snapshot.list.queryKey({ projectId }) })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  const onCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate({ projectId, name: trimmed })
  }

  return (
    <div className="grid gap-4">
      {canEdit && (
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="snap-name">이름</Label>
            <Input
              id="snap-name" value={name} placeholder="예: 배포 전 백업"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="button" disabled={create.isPending || name.trim() === ''} onClick={onCreate}>
            스냅샷 만들기
          </Button>
        </div>
      )}

      <div className="grid max-h-96 gap-2 overflow-y-auto">
        {list.isError && <p role="alert" className="text-sm text-destructive">{list.error.message}</p>}
        {list.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">아직 스냅샷이 없습니다</p>
        )}
        {list.data?.items.map((item) => (
          <SnapshotRow key={item.id} projectId={projectId} item={item} onRestored={onRestored} />
        ))}
      </div>
    </div>
  )
}

/**
 * 헤더의 "버전": 스냅샷·이력·비교, 로컬 모드에서는 변경 기록까지 섹션을 토글로 오간다.
 *
 * 열림 상태는 제어형이다 — 트리거는 `header-tools.tsx`가 렌더한다(설계 D5).
 */
export function VersionDialog({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [section, setSection] = useState<Section>('snapshot')
  // 이력은 revision.list 를 부른다 — 로컬 서버에는 그 프로시저가 없다.
  const isLocal = useIsLocal()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>버전</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button" size="sm" variant={section === 'snapshot' ? 'default' : 'outline'}
            onClick={() => setSection('snapshot')}
          >
            스냅샷
          </Button>
          {!isLocal && (
            <Button
              type="button" size="sm" variant={section === 'history' ? 'default' : 'outline'}
              onClick={() => setSection('history')}
            >
              이력
            </Button>
          )}
          <Button
            type="button" size="sm" variant={section === 'diff' ? 'default' : 'outline'}
            onClick={() => setSection('diff')}
          >
            비교
          </Button>
          {isLocal && (
            <Button
              type="button" size="sm" variant={section === 'changes' ? 'default' : 'outline'}
              onClick={() => setSection('changes')}
            >
              변경 기록
            </Button>
          )}
        </div>
        {section === 'snapshot' && (
          <SnapshotSection projectId={projectId} onRestored={() => onOpenChange(false)} />
        )}
        {!isLocal && section === 'history' && <HistoryView projectId={projectId} />}
        {section === 'diff' && (
          <SnapshotDiff projectId={projectId} onNavigate={() => onOpenChange(false)} />
        )}
        {isLocal && section === 'changes' && <ChangesSection />}
      </DialogContent>
    </Dialog>
  )
}
