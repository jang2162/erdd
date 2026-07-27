import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, ListChecks } from 'lucide-react'
import { computeWarnings, type Warning } from '@erdd/core'
import { useEditorStore } from './store.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

const KIND_LABEL: Record<Warning['kind'], string> = {
  'unknown-word': '미등록 단어',
  'term-mismatch': '용어 불일치',
  'too-long': '길이 초과',
  'reserved': '예약어',
  'duplicate-physical': '물리명 중복(컬럼)',
  'duplicate-physical-table': '물리명 중복(테이블)',
  'type-mismatch': '타입 불일치',
  'incomplete-mapping': '매핑 불완전',
  'custom-required': '필수 항목 미입력',
}

/** 경고가 가리키는 엔티티의 사람용 라벨(테이블/컬럼 물리명). */
function entityLabel(model: ReturnType<typeof useEditorStore.getState>['model'], w: Warning): string {
  if (w.scope === 'table') return model.tables[w.entityId]?.physicalName ?? '?'
  if (w.scope === 'column') {
    const c = model.columns[w.entityId]
    const t = c ? model.tables[c.tableId] : undefined
    return `${t?.physicalName ?? '?'}.${c?.physicalName ?? '?'}`
  }
  return model.relationships[w.entityId]?.name ?? '관계'
}

/** 헤더의 "모델 검사": 명명 규칙 위반·경고를 종류별로 모아 보고, 클릭 시 해당 엔티티로 이동한다. */
export function NamingCheck({ projectId: _projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const namingRules = useEditorStore((s) => s.namingRules)
  const dialects = useEditorStore((s) => s.dialects)
  const select = useEditorStore((s) => s.select)
  const selectRelationship = useEditorStore((s) => s.selectRelationship)
  const [open, setOpen] = useState(false)

  const warnings = useMemo(
    () => computeWarnings(model, namingRules, dialects), [model, namingRules, dialects])
  const groups = useMemo(() => {
    const map = new Map<Warning['kind'], Warning[]>()
    for (const w of warnings) {
      const list = map.get(w.kind)
      if (list) list.push(w)
      else map.set(w.kind, [w])
    }
    return [...map.entries()]
  }, [warnings])

  const goTo = (w: Warning) => {
    if (w.scope === 'relationship') selectRelationship(w.entityId)
    else if (w.scope === 'column') { if (w.tableId) select(w.tableId) }
    else select(w.entityId)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <ListChecks /> 모델 검사{warnings.length > 0 ? ` (${warnings.length})` : ''}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>모델 검사</DialogTitle></DialogHeader>
        {warnings.length === 0 && (
          <p className="text-sm text-muted-foreground">경고가 없습니다. 명명이 규칙에 부합합니다.</p>
        )}
        <div className="grid max-h-96 gap-4 overflow-y-auto">
          {groups.map(([kind, items]) => (
            <div key={kind} className="grid gap-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground">
                {KIND_LABEL[kind]} ({items.length})
              </h4>
              <ul className="grid gap-1">
                {items.map((w, i) => (
                  <li key={`${w.entityId}-${i}`}>
                    <button type="button" onClick={() => goTo(w)}
                      className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted">
                      {w.severity === 'error'
                        ? <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" />
                        : <AlertTriangle className="mt-0.5 size-3 shrink-0 text-key" />}
                      <span className="grid">
                        <span className="font-mono font-medium">{entityLabel(model, w)}</span>
                        <span className="text-muted-foreground">{w.message}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
