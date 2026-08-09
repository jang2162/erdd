import { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { computeWarnings, setRelationshipIdentifying, deleteRelationship, remapRelationshipChildColumn, resolveManyToMany } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { planJunction } from './edges.js'
import { newId } from './uid.js'
import { WarningBadge } from './warning-badge.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export function RelationshipPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const relId = useEditorStore((s) => s.selectedRelationshipId)!
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  // ⚠️ hook 은 아래 `if (!rel) return null` 보다 위에서 부른다 — 관계가 사라질 때 hook 개수가
  //    달라지면 React 가 터진다.
  const select = useEditorStore((s) => s.select)
  const namingRules = useEditorStore((s) => s.namingRules)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const mutate = useModelMutation(projectId)
  const rel = model.relationships[relId]
  const relWarnings = useMemo(
    () => computeWarnings(model).filter((w) => w.scope === 'relationship' && w.entityId === relId),
    [model, relId],
  )
  if (!rel) return null

  const parent = model.tables[rel.parentTableId]
  const child = model.tables[rel.childTableId]
  const childColumns = Object.values(model.columns)
    .filter((c) => c.tableId === rel.childTableId)
    .sort((a, b) => a.order - b.order)
  // hook 이 아니라 순수 계산이므로 조건문 아래여도 된다.
  const junctionPlan = planJunction(model, relId, newId, { namingRules, activeGroupView })

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">관계</h3>
          <WarningBadge warnings={relWarnings} />
        </div>
        {canEdit && (
          <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="관계 삭제"
            onClick={() => { selectRelationship(null); void mutate((m) => deleteRelationship(m, relId), { summary: '관계 삭제' }) }}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        <span className="font-mono">{child?.physicalName}</span> →{' '}
        <span className="font-mono">{parent?.physicalName}</span>
      </p>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>카디널리티</Label>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={rel.cardinality}
            disabled={!canEdit}
            onChange={(e) => {
              const cardinality = e.target.value as '1:1' | '1:N'
              void mutate((m) => {
                const r = m.relationships[relId]
                if (!r) return m
                return { ...m, relationships: { ...m.relationships, [relId]: { ...r, cardinality } } }
              })
            }}>
            <option value="1:N">1 : N</option>
            <option value="1:1">1 : 1</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rel.identifying} disabled={!canEdit}
            onChange={(e) => {
              // e.target 값은 호출 시점에 즉시 읽는다. producer는 직렬화로 마이크로태스크에 지연
              // 실행되는데, 그 사이 controlled input이 리셋되어 지연 읽기는 옛 값을 본다.
              const identifying = e.target.checked
              void mutate((m) => setRelationshipIdentifying(m, relId, identifying), { summary: '식별 관계 전환' })
            }} />
          식별 관계 (자식 기본 키 편입)
        </label>

        <div className="grid gap-1.5">
          <Label>관계명</Label>
          <input className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue={rel.name ?? ''}
            key={rel.name ?? ''} readOnly={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim() === '' ? null : e.target.value
              if (v !== rel.name) void mutate((m) => {
                const r = m.relationships[relId]
                if (!r) return m
                return { ...m, relationships: { ...m.relationships, [relId]: { ...r, name: v } } }
              })
            }} />
        </div>

        <div className="grid gap-1.5">
          <Label>컬럼 매핑</Label>
          <ul className="grid gap-2">
            {rel.columnMappings.map((mm) => {
              const p = model.columns[mm.parentColumnId]
              return (
                <li key={mm.parentColumnId} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 text-xs">
                  <select className="h-8 rounded border bg-background px-1 font-mono" value={mm.childColumnId}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const newChildColumnId = e.target.value
                      void mutate((m) => remapRelationshipChildColumn(m, { relationshipId: relId, parentColumnId: mm.parentColumnId, newChildColumnId }), { summary: '매핑 변경' })
                    }}>
                    {childColumns.map((c) => <option key={c.id} value={c.id}>{c.physicalName}</option>)}
                  </select>
                  <span className="text-muted-foreground">→</span>
                  <span className="truncate font-mono text-muted-foreground">{p?.physicalName ?? '?'}</span>
                </li>
              )
            })}
            {rel.columnMappings.length === 0 && <li className="text-xs text-muted-foreground">매핑 없음</li>}
          </ul>
        </div>

        {canEdit && (
          <div className="grid gap-1.5 border-t pt-3">
            <Button size="sm" variant="outline" disabled={!junctionPlan.ok}
              onClick={() => {
                if (!junctionPlan.ok) return
                const { junction, a, b } = junctionPlan
                // 선택을 교차 테이블로 옮긴다 — 이 mutation 으로 원본 관계가 사라지므로,
                // 선택이 관계에 남아 있으면 패널이 없는 관계를 그리려다 통째로 사라진다.
                // select 는 CLEARED_SELECTION 을 펼치므로(store.ts) 관계 선택도 함께 지운다.
                select(junction.id)
                void mutate(
                  (m) => resolveManyToMany(m, { relationshipId: relId, junction, a, b }),
                  { summary: '교차 테이블로 풀기' },
                )
              }}>
              교차 테이블로 풀기
            </Button>
            {!junctionPlan.ok && junctionPlan.reason === 'identifying' && (
              <p className="text-xs text-muted-foreground">
                식별 관계는 풀 수 없습니다 — 위 &quot;식별 관계&quot; 체크를 먼저 해제하세요
              </p>
            )}
            {!junctionPlan.ok && junctionPlan.reason === 'no-pk' && (
              <p className="text-xs text-muted-foreground">
                교차 테이블에 넘길 기본 키가 없습니다 — 부모에 기본 키가 있어야 하고,
                자식에는 이 관계의 FK 를 뺀 기본 키가 남아야 합니다
              </p>
            )}
            {!junctionPlan.ok && junctionPlan.reason === 'downstream' && (
              <p className="text-xs text-muted-foreground">
                이 관계의 FK 컬럼을 다른 관계가 참조하고 있어 풀 수 없습니다 — 먼저 그 관계를
                정리하세요
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
