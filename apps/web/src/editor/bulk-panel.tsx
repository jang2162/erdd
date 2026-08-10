import { useState } from 'react'
import {
  deleteTableCascade, MAX_OPS_PER_MUTATION, setTableGroup, type ProjectModel,
} from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { clearTableGroupPosition, moveTable } from './model-edits.js'
import { planGroupMove } from './group-move.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Mutate = ReturnType<typeof useModelMutation>

/** 드롭다운에서 "미분류"를 뜻하는 값. 빈 문자열은 "여러 그룹에 걸쳐 있음"이 이미 쓴다. */
const NO_GROUP = '__none__'

/** 삭제로 함께 사라지는 것들의 수. 관계는 양끝이 모두 선택돼 있어도 한 번만 센다. */
export function countCascade(model: ProjectModel, ids: readonly string[]): {
  tables: number; columns: number; indexes: number; relationships: number
} {
  const set = new Set(ids.filter((id) => Object.hasOwn(model.tables, id)))
  return {
    tables: set.size,
    columns: Object.values(model.columns).filter((c) => set.has(c.tableId)).length,
    indexes: Object.values(model.indexes).filter((ix) => set.has(ix.tableId)).length,
    relationships: Object.values(model.relationships)
      .filter((r) => set.has(r.parentTableId) || set.has(r.childTableId)).length,
  }
}

/** 연쇄 삭제가 만들어 낼 op 총수. 엔티티 하나당 delete op 하나다. */
function deleteOpCount(model: ProjectModel, ids: readonly string[]): number {
  const c = countCascade(model, ids)
  return c.tables + c.columns + c.indexes + c.relationships
}

/**
 * 그룹 배정과 좌표 재배치를 **한 producer**에 담는다 — Revision 1건, undo 1회.
 *
 * ⚠️ `planGroupMove`에는 **그룹 변경 전** 모델(`m`)을 넘긴다. 변경 후 모델(`next`)을 넘기면 이동
 * 대상이 이미 대상 그룹 멤버라 자기 자신이 기준 bbox에 섞인다.
 *
 * ⚠️ `groupPosition`을 null로 되돌린다. 테이블은 좌표를 둘 갖는데(전체 뷰 `position`, 그룹 뷰 전용
 * `groupPosition`), 그룹이 바뀌면 이전 그룹 뷰에서 잡아 둔 좌표는 의미가 없다. null이면 `buildNodes`가
 * 전체 뷰 좌표로 폴백해 새 그룹의 그룹 뷰에서 자연스럽게 자리를 잡는다.
 *
 * 사이드바 드래그·캔버스 드래그가 같은 진입점을 쓰도록 export한다 — 경로가 갈리면 한쪽만 고쳐진다.
 */
export function applyGroupMove(
  mutate: Mutate, ids: readonly string[], targetGroupId: string | null,
): void {
  if (ids.length === 0) return
  void mutate((m) => {
    let next = m
    for (const id of ids) {
      next = setTableGroup(next, id, targetGroupId)
      next = clearTableGroupPosition(next, id)
    }
    for (const move of planGroupMove(m, ids, targetGroupId)) {
      next = moveTable(next, move.id, move.position)
    }
    return next
  }, { summary: `그룹 이동 (${ids.length}개)` })
}

/**
 * 일괄 삭제 확인. **툴바와 일괄 패널이 함께 쓴다** — 복붙하면 문구·동작이 한쪽만 고쳐질 자리가 생긴다.
 *
 * op 상한 가드도 여기 둔다. 진입점이 둘이므로 트리거 쪽에 두면 한쪽(툴바)이 가드 없이 제출한다.
 * 상한을 넘으면 서버가 거절하는데, 그때는 이미 낙관 반영이 끝나 화면이 되돌려지는 것을 사용자가 본다.
 */
export function BulkDeleteDialog({ projectId, ids, open, onOpenChange }: {
  projectId: string; ids: readonly string[]; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const tables = ids.map((id) => model.tables[id]).filter((t) => t !== undefined)
  const cascade = countCascade(model, ids)
  const opCount = deleteOpCount(model, ids)
  const tooBig = opCount > MAX_OPS_PER_MUTATION

  // 선택에서 걷어내는 것은 여기서 하지 않는다 — useSubmit의 낙관적 setModel 직후 pruneSelection이
  // 모든 로컬 쓰기 경로를 덮는다. 여기서 또 비우면 규칙이 두 벌이 되고, 서버가 거절해 아무것도
  // 지워지지 않은 경우에도 선택만 사라진다.
  const onDelete = () => {
    const doomed = [...ids]
    onOpenChange(false)
    void mutate((m) => doomed.reduce((acc, id) => deleteTableCascade(acc, id), m),
      { summary: `테이블 삭제 (${doomed.length}개)` })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>선택한 테이블을 삭제할까요?</DialogTitle>
          <DialogDescription>
            테이블 {cascade.tables}개와 관계 {cascade.relationships}개가 삭제됩니다.
            컬럼 {cascade.columns}개와 인덱스 {cascade.indexes}개도 함께 사라집니다.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto rounded border p-2">
          {tables.map((t) => (
            <li key={t.id} className="font-mono text-xs">{t.physicalName}</li>
          ))}
        </ul>
        {tooBig && (
          <p className="text-xs text-destructive">
            한 번에 지우기에 너무 많습니다({opCount}개 항목, 상한 {MAX_OPS_PER_MUTATION}개).
            나눠서 삭제해 주세요.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button variant="destructive" disabled={tooBig} onClick={onDelete}>삭제</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 2개 이상 선택했을 때 편집 패널을 대신하는 일괄 작업 패널. 상세 편집(컬럼·논리명)은 다중 선택에서
 * 의미가 모호하므로 그룹 이동과 삭제만 둔다. 그룹 드롭다운은 **드래그의 접근성 대체 경로**다 —
 * 드래그만이 유일한 길이면 키보드·보조기술 사용자가 그룹 이동에서 막힌다.
 */
export function BulkPanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const ids = useEditorStore((s) => s.selectedTableIds)
  const mutate = useModelMutation(projectId)
  const [confirming, setConfirming] = useState(false)

  const tables = ids.map((id) => model.tables[id]).filter((t) => t !== undefined)

  // 전원이 같은 그룹이면 그 값을 보여주고, 섞여 있으면 빈 값(= 안내 문구)을 보여준다.
  const groupIds = new Set(tables.map((t) => t.groupId))
  const commonGroup = groupIds.size === 1 ? [...groupIds][0] : undefined

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{ids.length}개 테이블 선택됨</h2>

      <ul className="mb-4 max-h-48 overflow-y-auto rounded border">
        {tables.map((t) => (
          <li key={t.id} className="flex items-baseline gap-2 px-2 py-1">
            <span className="font-mono text-xs font-medium">{t.physicalName}</span>
            <span className="truncate text-xs text-muted-foreground">{t.logicalName}</span>
          </li>
        ))}
      </ul>

      <div className="mb-4 grid gap-1.5">
        <Label htmlFor="bulk-group">선택 테이블의 그룹</Label>
        <select id="bulk-group"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={commonGroup === undefined ? '' : (commonGroup ?? NO_GROUP)}
          disabled={!canEdit}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return
            applyGroupMove(mutate, ids, raw === NO_GROUP ? null : raw)
          }}>
          {commonGroup === undefined && <option value="">여러 그룹에 걸쳐 있음</option>}
          <option value={NO_GROUP}>미분류</option>
          {Object.values(model.tableGroups).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <Button variant="destructive" className="w-full" disabled={!canEdit}
        onClick={() => setConfirming(true)}>선택 테이블 삭제</Button>

      <BulkDeleteDialog projectId={projectId} ids={ids} open={confirming} onOpenChange={setConfirming} />
    </aside>
  )
}
