import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Library } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyResyncPlan, planResync, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, resourcePayloadOf,
  type LibraryItem, type ProjectModel, type ResyncEntry, type ResyncPlan,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { countActive, initialDecisions, setAllForStatus, type Decisions } from './resource-decisions.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

/** model.mutate의 ops 상한(500)과 같다. 초과하면 적용 전에 막는다. */
const MAX_OPS = 500

const EMPTY_PLAN: ResyncPlan = {
  libraryId: '', entries: [], keptLocal: 0, keptSynced: 0, keptDetached: 0,
}

function EntryLabel({ entry }: { entry: ResyncEntry }) {
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
      </span>
      {entry.status !== 'added' && (
        <span className="text-xs text-muted-foreground">
          v{entry.fromVersion} → v{entry.version}
          {entry.changedFields.length > 0 && ` · ${entry.changedFields.join(', ')}`}
        </span>
      )}
    </span>
  )
}

/** 화면 표시용 값 포맷 — null/undefined는 "(없음)", 객체·배열은 JSON으로 떨어뜨린다. */
function formatConflictValue(value: unknown): string {
  if (value === null || value === undefined) return '(없음)'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** 충돌 항목의 프로젝트 현재 payload — origin 없는 신규(added)면 null. */
function currentProjectPayload(model: ProjectModel, entry: ResyncEntry): Record<string, unknown> | null {
  if (!entry.projectEntityId) return null
  const collection = model[RESOURCE_COLLECTION_BY_KIND[entry.kind]] as Record<string, Record<string, unknown>>
  const entity = collection[entry.projectEntityId]
  if (!entity) return null
  return resourcePayloadOf(entry.kind, entity)
}

/**
 * 충돌 항목의 필드별 "현재(프로젝트) ↔ 원본" 비교. "프로젝트 유지"는 이 변경을 검토·거절했다고
 * 영구 기록해 다시 띄우지 않으므로, 값을 못 본 채 고르면 원본 개선을 영원히 놓친다.
 */
function ConflictValueDiff({ entry, model }: { entry: ResyncEntry; model: ProjectModel }) {
  const current = currentProjectPayload(model, entry)
  if (!current || entry.changedFields.length === 0) return null
  return (
    <ul className="grid gap-0.5 text-xs text-muted-foreground">
      {entry.changedFields.map((field) => (
        <li key={field}>
          <span className="font-medium text-foreground">{field}</span>
          {': 현재 '}
          <span>{formatConflictValue(current[field])}</span>
          {' → 원본 '}
          <span>{formatConflictValue(entry.nextPayload[field])}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 헤더의 "공용 리소스": 전역·조직 라이브러리를 프로젝트로 가져오고 재동기화한다.
 * 최초 가져오기는 "전 항목이 신규인 재동기화"라 코드 경로가 하나다.
 * 적용은 단일 producer → diffModels → model.mutate라 Revision 1건·undo 1회로 원복된다.
 */
export function ResourcePanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC()
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const [open, setOpen] = useState(false)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Decisions>({})

  const libraries = useQuery(trpc.resource.library.listForProject.queryOptions({ projectId }))
  const items = useQuery({
    ...trpc.resource.items.list.queryOptions({ libraryId: libraryId ?? '' }),
    enabled: libraryId !== null,
  })

  const plan = useMemo(() => {
    if (!libraryId || !items.data) return EMPTY_PLAN
    return planResync(model, libraryId, items.data as LibraryItem[])
  }, [model, libraryId, items.data])

  // 계획이 다시 계산되면(모델 변경·라이브러리 전환·항목 재조회) 결정을 초기값으로 되돌린다.
  useEffect(() => { setDecisions(initialDecisions(plan)) }, [plan])

  const library = libraries.data?.find((l) => l.id === libraryId)
  const byStatus = (status: ResyncEntry['status']) => plan.entries.filter((e) => e.status === status)
  const added = byStatus('added')
  const autoUpdate = byStatus('auto-update')
  const conflicts = byStatus('conflict')
  const active = countActive(decisions)

  const onApply = () => {
    if (active === 0) return
    if (active > MAX_OPS) {
      toast.error(`한 번에 ${MAX_OPS}건까지 적용할 수 있습니다. 나눠 선택해 주세요.`)
      return
    }
    const applied = decisions
    const currentPlan = plan
    void mutate((m) => applyResyncPlan(m, currentPlan, applied, newId), {
      summary: `공용 리소스 재동기화 — ${library?.name ?? ''}`,
    })
  }

  const checkboxRow = (entry: ResyncEntry) => (
    <li key={entry.sourceId} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
      <label className="flex flex-1 items-center gap-2">
        <input type="checkbox" aria-label={`${entry.name} 선택`}
          checked={decisions[entry.sourceId] === 'apply'}
          onChange={(e) => {
            const next = e.target.checked ? 'apply' : 'defer'
            setDecisions((prev) => ({ ...prev, [entry.sourceId]: next }))
          }} />
        <EntryLabel entry={entry} />
      </label>
      {entry.nameClash && <Badge variant="outline" className="shrink-0">이름 중복</Badge>}
    </li>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><Library /> 공용 리소스</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>공용 리소스</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="grid content-start gap-1">
            <h4 className="text-xs font-semibold text-muted-foreground">라이브러리</h4>
            {libraries.isError && (
              <p role="alert" className="text-destructive">{libraries.error.message}</p>
            )}
            {!libraries.isError && libraries.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">사용할 수 있는 라이브러리가 없습니다</p>
            )}
            {libraries.data?.map((lib) => (
              <button key={lib.id} type="button"
                className={`rounded border px-2 py-1.5 text-left text-sm ${libraryId === lib.id ? 'border-primary' : ''}`}
                onClick={() => setLibraryId(lib.id)}>
                <span className="block">{lib.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {lib.scope === 'global' ? '전역' : '조직'} · 항목 {lib.itemCount}개
                </span>
              </button>
            ))}
          </div>

          <div className="grid max-h-[60vh] content-start gap-4 overflow-y-auto">
            {libraryId === null && (
              <p className="text-sm text-muted-foreground">
                라이브러리를 선택하면 가져올 항목과 갱신 내역을 보여줍니다.
              </p>
            )}

            {libraryId !== null && items.isError && (
              <p role="alert" className="text-destructive">{items.error.message}</p>
            )}

            {libraryId !== null && !items.isError && (
              <>
                <section className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">신규 추가 ({added.length})</h4>
                    {added.length > 0 && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'added', 'apply'))}>
                          모두 선택
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'added', 'defer'))}>
                          모두 해제
                        </Button>
                      </span>
                    )}
                  </div>
                  <ul className="grid gap-1">{added.map(checkboxRow)}</ul>
                </section>

                <section className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">자동 갱신 ({autoUpdate.length})</h4>
                    {autoUpdate.length > 0 && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'auto-update', 'apply'))}>
                          모두 선택
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'auto-update', 'defer'))}>
                          모두 해제
                        </Button>
                      </span>
                    )}
                  </div>
                  <ul className="grid gap-1">{autoUpdate.map(checkboxRow)}</ul>
                </section>

                <section className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">충돌 ({conflicts.length})</h4>
                    {conflicts.length > 0 && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'conflict', 'apply'))}>
                          모두 원본 반영
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => setDecisions((p) => setAllForStatus(p, plan, 'conflict', 'keep'))}>
                          모두 프로젝트 유지
                        </Button>
                      </span>
                    )}
                  </div>
                  {conflicts.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      "프로젝트 유지"는 내용을 그대로 두고 이 변경을 검토했다고 기록합니다(다음에 다시 뜨지 않습니다).
                      "보류"는 아무것도 기록하지 않아 다음에 다시 뜹니다.
                    </p>
                  )}
                  <ul className="grid gap-1">
                    {conflicts.map((entry) => (
                      <li key={entry.sourceId} className="grid gap-1 rounded border px-2 py-1.5">
                        <EntryLabel entry={entry} />
                        <ConflictValueDiff entry={entry} model={model} />
                        <div className="flex flex-wrap gap-3 text-sm">
                          {([
                            ['defer', '보류'], ['keep', '프로젝트 유지'], ['apply', '원본 반영'],
                          ] as const).map(([value, label]) => (
                            <label key={value} className="flex items-center gap-1">
                              <input type="radio" aria-label={`${entry.name} ${label}`}
                                name={`conflict-${entry.sourceId}`}
                                checked={(decisions[entry.sourceId] ?? 'defer') === value}
                                onChange={() =>
                                  setDecisions((prev) => ({ ...prev, [entry.sourceId]: value }))} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="grid gap-1 text-xs text-muted-foreground">
                  <h4 className="text-sm font-semibold text-foreground">유지</h4>
                  <span>최신 상태 {plan.keptSynced}건 · 프로젝트 자체 항목 {plan.keptLocal}건</span>
                  {plan.keptDetached > 0 && (
                    <span>원본에서 삭제된 항목 {plan.keptDetached}건 — 프로젝트 사본은 그대로 둡니다.</span>
                  )}
                </section>

                <div className="flex items-center justify-end gap-2 border-t pt-2">
                  <span className="text-xs text-muted-foreground">처리 대상 {active}건</span>
                  <Button type="button" disabled={active === 0} onClick={onApply}>적용</Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
