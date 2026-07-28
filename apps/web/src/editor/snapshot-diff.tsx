import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DIFF_KIND_LABEL, buildChangeSheet, createEmptyModel, diffModelsForDisplay,
  type DiffEntry, type EntityKind, type ProjectModel,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCreatedAt } from '@/lib/format'
import { useEditorStore } from './store.js'
import { downloadExcelWorkbook } from './excel-file.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

/** 'current'는 편집 중인 모델, 그 외는 스냅샷 id. */
type Side = 'current' | string

const CHANGE_LABEL = { added: '추가', removed: '삭제', changed: '변경' } as const

/** 스냅샷 jsonb는 zod 파싱을 거치지 않는다 — 복원 경로와 같은 방식으로 누락 컬렉션을 보충한다. */
function normalize(model: unknown): ProjectModel {
  return { ...createEmptyModel(), ...(model as Partial<ProjectModel>) }
}

/** 캔버스에 대응 객체가 있어 클릭 이동이 되는 종류. */
function isNavigable(kind: EntityKind): boolean {
  return kind === 'table' || kind === 'column' || kind === 'index' || kind === 'relationship'
}

/** 헤더 "버전"의 비교 섹션: 두 시점을 골라 변경 목록을 보고 변경분 정의서를 내보낸다. */
export function SnapshotDiff({
  projectId, onNavigate,
}: { projectId: string; onNavigate: () => void }) {
  const trpc = useTRPC()
  const currentModel = useEditorStore((s) => s.model)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)

  const list = useQuery(trpc.snapshot.list.queryOptions({ projectId }))
  const items = list.data?.items ?? []

  const [base, setBase] = useState<Side | null>(null)
  const [target, setTarget] = useState<Side>('current')
  // 기본값: 기준=최근 스냅샷. 목록이 늦게 오므로 첫 렌더 이후에 정해진다.
  const effectiveBase: Side | null = base ?? items[0]?.id ?? null

  const baseSnap = useQuery(trpc.snapshot.get.queryOptions(
    { projectId, snapshotId: effectiveBase ?? '' },
    { enabled: effectiveBase !== null && effectiveBase !== 'current' },
  ))
  const targetSnap = useQuery(trpc.snapshot.get.queryOptions(
    { projectId, snapshotId: target },
    { enabled: target !== 'current' },
  ))

  const labelOfSide = (side: Side | null): string =>
    side === null ? '' : side === 'current' ? '현재' : items.find((i) => i.id === side)?.name ?? '?'

  const baseModel = effectiveBase === 'current'
    ? currentModel
    : baseSnap.data ? normalize(baseSnap.data.model) : null
  const targetModel = target === 'current'
    ? currentModel
    : targetSnap.data ? normalize(targetSnap.data.model) : null

  const diff = useMemo(
    () => (baseModel && targetModel ? diffModelsForDisplay(baseModel, targetModel) : null),
    [baseModel, targetModel],
  )

  const onClickEntry = (e: DiffEntry) => {
    if (!isNavigable(e.kind)) return
    if (e.kind === 'relationship') selectRelationship(e.entityId)
    else select(e.parentTableId ?? e.entityId)
    onNavigate()
  }

  const onDownload = () => {
    if (!diff) return
    const sheet = buildChangeSheet(diff, {
      baseLabel: labelOfSide(effectiveBase), targetLabel: labelOfSide(target),
    })
    void downloadExcelWorkbook([sheet], 'erdd_변경분정의서.xlsx')
      .catch(() => toast.error('변경분 정의서를 만들지 못했습니다'))
  }

  if (list.isPending) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  if (list.isError) {
    return <p className="text-sm text-destructive">스냅샷 목록을 불러오지 못했습니다</p>
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        비교하려면 스냅샷이 하나 이상 필요합니다. 아직 스냅샷이 없습니다
      </p>
    )
  }

  const options: { value: Side; label: string }[] = [
    { value: 'current', label: '현재' },
    ...items.map((i) => ({ value: i.id, label: `${i.name} (${formatCreatedAt(i.createdAt)})` })),
  ]
  const loadFailed = baseSnap.isError || targetSnap.isError
  const loading = baseSnap.isPending && effectiveBase !== 'current'
    || targetSnap.isPending && target !== 'current'

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="diff-base">기준</Label>
          <select
            id="diff-base" className="h-9 rounded-md border bg-background px-2 text-sm"
            value={effectiveBase ?? 'current'}
            onChange={(e) => setBase(e.target.value)}
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="diff-target">비교</Label>
          <select
            id="diff-target" className="h-9 rounded-md border bg-background px-2 text-sm"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {effectiveBase === target && (
        <p className="text-sm text-muted-foreground">같은 시점을 비교하고 있습니다</p>
      )}
      {loadFailed && <p className="text-sm text-destructive">스냅샷을 불러오지 못했습니다</p>}
      {loading && !loadFailed && <p className="text-sm text-muted-foreground">불러오는 중…</p>}

      {diff && !loadFailed && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              추가 {diff.counts.added} · 삭제 {diff.counts.removed} · 변경 {diff.counts.changed}
            </p>
            <Button
              type="button" size="sm" variant="outline"
              disabled={diff.entries.length === 0} onClick={onDownload}
            >
              <Download /> 변경분 정의서
            </Button>
          </div>
          {diff.entries.length === 0
            ? <p className="text-sm text-muted-foreground">차이가 없습니다</p>
            : (
                <ul className="grid max-h-96 gap-1 overflow-y-auto">
                  {diff.entries.map((e) => (
                    <li key={`${e.kind}-${e.entityId}`} className="rounded border p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{DIFF_KIND_LABEL[e.kind]}</span>
                        {isNavigable(e.kind)
                          ? (
                              <button
                                type="button" className="font-mono font-medium hover:underline"
                                onClick={() => onClickEntry(e)}
                              >
                                {e.label}
                              </button>
                            )
                          : <span className="font-mono font-medium">{e.label}</span>}
                        <span className="ml-auto">{CHANGE_LABEL[e.changeKind]}</span>
                      </div>
                      {e.fields.length > 0 && (
                        <ul className="mt-1 grid gap-0.5 text-muted-foreground">
                          {e.fields.map((f) => (
                            <li key={f.field}>
                              {f.label}: {f.before || '(없음)'} → {f.after || '(없음)'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
        </>
      )}
    </div>
  )
}
