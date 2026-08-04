import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyResyncPlan, planResync, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, resourcePayloadOf,
  type LibraryItem, type ProjectModel, type ResyncEntry, type ResyncPlan,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { countActive, initialDecisions, overLimitMessage, setAllForStatus, type Decisions } from './resource-decisions.js'
import type { LibraryRow } from './resource-panel.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

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
 * "공용 리소스" 다이얼로그의 가져오기(재동기화) 탭: 전역·조직 라이브러리를 프로젝트로
 * 가져오고 재동기화한다. 최초 가져오기는 "전 항목이 신규인 재동기화"라 코드 경로가 하나다.
 * 적용은 단일 producer → diffModels → model.mutate라 Revision 1건·undo 1회로 원복된다.
 */
export function ResourceResyncTab({ projectId, library }: { projectId: string; library: LibraryRow }) {
  const trpc = useTRPC()
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [decisions, setDecisions] = useState<Decisions>({})

  const items = useQuery(trpc.resource.items.list.queryOptions({ libraryId: library.id }))

  const plan = useMemo(() => {
    if (!items.data) return EMPTY_PLAN
    return planResync(model, library.id, items.data as LibraryItem[])
  }, [model, library.id, items.data])

  // 계획이 다시 계산되면(모델 변경·라이브러리 전환·항목 재조회) 결정을 초기값으로 되돌린다.
  useEffect(() => { setDecisions(initialDecisions(plan)) }, [plan])

  const byStatus = (status: ResyncEntry['status']) => plan.entries.filter((e) => e.status === status)
  const added = byStatus('added')
  const autoUpdate = byStatus('auto-update')
  const conflicts = byStatus('conflict')
  const active = countActive(decisions)

  const onApply = () => {
    if (active === 0) return
    const message = overLimitMessage(active)
    if (message !== null) { toast.error(message); return }
    const applied = decisions
    const currentPlan = plan
    void mutate((m) => applyResyncPlan(m, currentPlan, applied, newId), {
      summary: `공용 리소스 재동기화 — ${library.name}`,
    })
  }

  const checkboxRow = (entry: ResyncEntry) => (
    <li key={entry.sourceId} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
      {canEdit
        ? (
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" aria-label={`${entry.name} 선택`}
                checked={decisions[entry.sourceId] === 'apply'}
                onChange={(e) => {
                  const next = e.target.checked ? 'apply' : 'defer'
                  setDecisions((prev) => ({ ...prev, [entry.sourceId]: next }))
                }} />
              <EntryLabel entry={entry} />
            </label>
          )
        : (
            <span className="flex flex-1 items-center gap-2"><EntryLabel entry={entry} /></span>
          )}
      {entry.nameClash && <Badge variant="outline" className="shrink-0">이름 중복</Badge>}
    </li>
  )

  if (items.isError) {
    return <p role="alert" className="text-destructive">{items.error.message}</p>
  }

  return (
    <>
      <section className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">신규 추가 ({added.length})</h4>
          {canEdit && added.length > 0 && (
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
          {canEdit && autoUpdate.length > 0 && (
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
          {canEdit && conflicts.length > 0 && (
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
        {canEdit && conflicts.length > 0 && (
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
              {canEdit && (
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
              )}
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

      {canEdit && (
        <div className="flex items-center justify-end gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">처리 대상 {active}건</span>
          <Button type="button" disabled={active === 0} onClick={onApply}>적용</Button>
        </div>
      )}
    </>
  )
}
