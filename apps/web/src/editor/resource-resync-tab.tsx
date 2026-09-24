import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  applyResyncPlan, planResync, RESOURCE_COLLECTION_BY_KIND, RESOURCE_KIND_LABEL, resourcePayloadOf,
  resourceSecondaryName,
  type LibraryItem, type ProjectModel, type ResyncDecision, type ResyncEntry, type ResyncPlan,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCount, formatProgress } from '@/lib/format'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { carryDecisions, countActive, setAllForStatus, type Decisions } from './resource-decisions.js'
import type { LibraryRow } from './resource-panel.js'
import { PagedSection } from '@/components/paged-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const EMPTY_PLAN: ResyncPlan = {
  libraryId: '', entries: [], keptLocal: 0, keptSynced: 0, keptDetached: 0,
}

/** 구역 검색 칸 — 논리명 칸과 물리명 칸(core resourceSecondaryName). */
const ENTRY_FIELDS = (entry: ResyncEntry) => [entry.name, resourceSecondaryName(entry.kind, entry.nextPayload)]

function EntryLabel({ entry }: { entry: ResyncEntry }) {
  const physical = resourceSecondaryName(entry.kind, entry.nextPayload)
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{RESOURCE_KIND_LABEL[entry.kind]}</span>
        <span>{entry.name}</span>
        {physical !== null && <span className="font-mono text-xs text-muted-foreground">{physical}</span>}
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
 * 적용은 단일 producer → diffModels → model.mutate 이고 실행 취소 한 번으로 원복된다. 5,000건을 넘으면
 * 저수준 경로가 조각으로 나눠 보내 Revision 은 조각 수만큼 쌓인다(guides/data-layer.md 「한 요청의 op 상한은 …」)
 * — 이 탭은 나눔을 모르고 진행(`onProgress`)만 보인다.
 *
 * 구역마다 검색·50건 페이지가 있고(`PagedSection`), 결정(`decisions`)은 구역 전체에 대해 여기 있다 —
 * 쪽을 넘겨도 체크가 남고 일괄 버튼은 구역 전체에 적용된다.
 */
export function ResourceResyncTab({ projectId, library }: { projectId: string; library: LibraryRow }) {
  const trpc = useTRPC()
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const [decisions, setDecisions] = useState<Decisions>({})
  // 조각이 둘 이상일 때만 채워진다(저수준 경로가 onProgress 를 그때만 부른다). ref 는 리렌더 전 재진입을 막는다.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const applyingRef = useRef(false)

  const items = useQuery(trpc.resource.items.list.queryOptions({ libraryId: library.id }))

  const plan = useMemo(() => {
    if (!items.data) return EMPTY_PLAN
    return planResync(model, library.id, items.data as LibraryItem[])
  }, [model, library.id, items.data])

  // 계획이 다시 계산되면(모델 변경·라이브러리 전환·항목 재조회) 사용자가 정한 결정은 잇고 새 항목만 기본값을 받는다.
  // 실시간 편집이 도착할 때마다 보이지 않는 쪽의 체크가 조용히 되살아나면 안 된다. 라이브러리가 바뀌면 처음부터다.
  const prevPlanRef = useRef<ResyncPlan | null>(null)
  useEffect(() => {
    const prevPlan = prevPlanRef.current
    prevPlanRef.current = plan
    setDecisions((prev) => carryDecisions(prevPlan, prev, plan))
  }, [plan])

  const sections = useMemo(() => ({
    added: plan.entries.filter((e) => e.status === 'added'),
    autoUpdate: plan.entries.filter((e) => e.status === 'auto-update'),
    conflicts: plan.entries.filter((e) => e.status === 'conflict'),
  }), [plan])
  const active = countActive(decisions)
  const setAll = (status: ResyncEntry['status'], decision: ResyncDecision) =>
    setDecisions((prev) => setAllForStatus(prev, plan, status, decision))

  const onApply = async () => {
    if (active === 0 || applyingRef.current) return
    applyingRef.current = true
    const applied = decisions
    const currentPlan = plan
    try {
      await mutate((m) => applyResyncPlan(m, currentPlan, applied, newId), {
        summary: `공용 리소스 재동기화 — ${library.name}`,
        onProgress: (done, total) => setProgress({ done, total }),
      })
    } finally {
      applyingRef.current = false
      setProgress(null)
    }
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

  const conflictRow = (entry: ResyncEntry) => (
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
  )

  if (items.isError) {
    return <p role="alert" className="text-destructive">{items.error.message}</p>
  }

  return (
    <>
      {/* 구역의 검색어·쪽은 라이브러리마다 처음부터다 — key 로 라이브러리를 바꿀 때 구역 상태를 버린다. */}
      <PagedSection key={`added:${library.id}`} title="신규 추가" rows={sections.added} fields={ENTRY_FIELDS} renderRow={checkboxRow}
        actions={canEdit ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAll('added', 'apply')}>모두 선택</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll('added', 'defer')}>모두 해제</Button>
          </>
        ) : undefined} />

      <PagedSection key={`auto-update:${library.id}`} title="자동 갱신" rows={sections.autoUpdate} fields={ENTRY_FIELDS} renderRow={checkboxRow}
        actions={canEdit ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAll('auto-update', 'apply')}>모두 선택</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll('auto-update', 'defer')}>모두 해제</Button>
          </>
        ) : undefined} />

      <PagedSection key={`conflicts:${library.id}`} title="충돌" rows={sections.conflicts} fields={ENTRY_FIELDS} renderRow={conflictRow}
        actions={canEdit ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAll('conflict', 'apply')}>모두 원본 반영</Button>
            <Button size="sm" variant="ghost" onClick={() => setAll('conflict', 'keep')}>모두 프로젝트 유지</Button>
          </>
        ) : undefined}>
        {canEdit && sections.conflicts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            "프로젝트 유지"는 내용을 그대로 두고 이 변경을 검토했다고 기록합니다(다음에 다시 뜨지 않습니다).
            "보류"는 아무것도 기록하지 않아 다음에 다시 뜹니다.
          </p>
        )}
      </PagedSection>

      <section className="grid gap-1 text-xs text-muted-foreground">
        <h4 className="text-sm font-semibold text-foreground">유지</h4>
        <span>최신 상태 {formatCount(plan.keptSynced)}건 · 프로젝트 자체 항목 {formatCount(plan.keptLocal)}건</span>
        {plan.keptDetached > 0 && (
          <span>원본에서 삭제된 항목 {formatCount(plan.keptDetached)}건 — 프로젝트 사본은 그대로 둡니다.</span>
        )}
      </section>

      {canEdit && (
        <div className="flex items-center justify-end gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">처리 대상 {formatCount(active)}건</span>
          <Button type="button" disabled={active === 0 || progress !== null} onClick={() => { void onApply() }}>
            {progress !== null ? formatProgress(progress.done, progress.total) : '적용'}
          </Button>
        </div>
      )}
    </>
  )
}
