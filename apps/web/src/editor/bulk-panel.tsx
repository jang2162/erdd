import { useState } from 'react'
import { toast } from 'sonner'
import {
  deleteTableCascade, setTableGroup, type ProjectModel,
} from '@erdd/core'
import { formatCount, formatProgress } from '@/lib/format'
import { useEditorStore } from './store.js'
import { useModelMutation, type Mutate } from './use-model.js'
import { clearTableGroupPosition, moveTable } from './model-edits.js'
import { createGroupWith } from './group-edits.js'
import { planGroupMove } from './group-move.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

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

/**
 * 그룹 배정과 좌표 재배치를 **한 producer**에 담는다 — 편집 1건 · 실행 취소 1회.
 *
 * `planGroupMove`에 **그룹 변경 전** 모델(`m`)을 넘기는 것은 읽기 좋음의 관례다 — 정확성 요건이
 * 아니다. `planGroupMove`가 이동 집합을 기준 bbox에서 스스로 제외하므로 `next`를 넘겨도 결과가 같다.
 *
 * ⚠️ `groupPosition`은 **이동 대상 전원** 것을 null로 되돌린다 — 이미 대상 그룹에 있던 것도 포함이다.
 * 테이블은 좌표를 둘 갖는데(전체 뷰 `position`, 그룹 뷰 전용 `groupPosition`), 남겨 두면 함께 옮긴
 * 것들이 그룹 뷰에서 갈라진다(하나는 옛 좌표, 나머지는 폴백 좌표). 전원 비워야 `buildNodes`가 모두
 * 전체 뷰 좌표로 폴백해 새 그룹의 그룹 뷰에서 나란히 선다.
 *
 * 사이드바 드래그·캔버스 드래그가 같은 진입점을 쓰도록 export한다 — 경로가 갈리면 한쪽만 고쳐진다.
 * **무엇을 넣을지 정하는 규칙도 전부 여기 있다**(권한·빈 선택·"전원이 이미 그 그룹"). 호출자가
 * 각자 거르면 같은 사용자 의도가 진입점에 따라 다른 좌표로 끝난다 — 실제로 갈라졌던 자리다.
 */
export function applyGroupMove(
  mutate: Mutate, ids: readonly string[], targetGroupId: string | null,
): void {
  if (ids.length === 0) return
  // 권한 판정도 여기 한 곳이다. 드래그·드롭다운·(예정된) 캔버스 드롭이 전부 이 함수를 지나므로
  // 호출자마다 붙이면 같은 가드가 세 벌이 된다. useSubmit도 canEdit을 막지만 그쪽은 **토스트를
  // 띄운다** — 드래그 도중 권한이 회수된 경우 사용자가 하지도 않은 편집으로 에러를 보게 된다.
  if (!useEditorStore.getState().canEdit) return
  // 전원이 이미 대상 그룹이면 아무 뜻도 없는 Revision이 하나 생긴다 — 아예 내지 않는다.
  // ⚠️ "항목마다 거른다"가 **아니다.** 섞인 선택에서 이미 대상 그룹에 있던 것도 함께 옮겨야
  // groupPosition이 전원 비워져 그룹 뷰에서 갈라지지 않는다(위 ⚠️).
  const model = useEditorStore.getState().model
  if (ids.every((id) => model.tables[id]?.groupId === targetGroupId)) return
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
  }, { summary: `그룹 이동 (${formatCount(ids.length)}개)` })
}

/**
 * 일괄 삭제 확인. **툴바와 일괄 패널이 함께 쓴다** — 복붙하면 문구·동작이 한쪽만 고쳐질 자리가 생긴다.
 *
 * 5,000건을 넘는 삭제도 막지 않는다 — 저수준 경로가 조각으로 나눠 보낸다(guides/data-layer.md 「한 요청의
 * op 상한은 …」). 이 창은 제출과 함께 닫히고, 이 창을 띄운 일괄 패널도 낙관적 삭제로 선택이 비는 순간
 * 사라지므로 조각 진행은 창이 아니라 토스트로 알린다.
 */
export function BulkDeleteDialog({ projectId, ids, open, onOpenChange }: {
  projectId: string; ids: readonly string[]; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const model = useEditorStore((s) => s.model)
  const mutate = useModelMutation(projectId)
  const tables = ids.map((id) => model.tables[id]).filter((t) => t !== undefined)
  const cascade = countCascade(model, ids)

  // 선택에서 걷어내는 것은 여기서 하지 않는다 — useSubmit의 낙관적 setModel 직후 pruneSelection이
  // 모든 로컬 쓰기 경로를 덮는다. 여기서 또 비우면 규칙이 두 벌이 되고, 서버가 거절해 아무것도
  // 지워지지 않은 경우에도 선택만 사라진다.
  const onDelete = () => {
    const doomed = [...ids]
    const progressToast = `bulk-delete-${Date.now()}`
    onOpenChange(false)
    void mutate((m) => doomed.reduce((acc, id) => deleteTableCascade(acc, id), m), {
      summary: `테이블 삭제 (${formatCount(doomed.length)}개)`,
      onProgress: (done, total) => {
        if (done < total) toast.loading(formatProgress(done, total), { id: progressToast })
        else toast.dismiss(progressToast)
      },
    }).finally(() => toast.dismiss(progressToast))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>선택한 테이블을 삭제할까요?</DialogTitle>
          <DialogDescription>
            테이블 {formatCount(cascade.tables)}개와 관계 {formatCount(cascade.relationships)}개가 삭제됩니다.
            컬럼 {formatCount(cascade.columns)}개와 인덱스 {formatCount(cascade.indexes)}개도 함께 사라집니다.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto rounded border p-2">
          {tables.map((t) => (
            <li key={t.id} className="font-mono text-xs">{t.physicalName}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button variant="destructive" onClick={onDelete}>삭제</Button>
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
  const selectGroup = useEditorStore((s) => s.selectGroup)

  const tables = ids.map((id) => model.tables[id]).filter((t) => t !== undefined)

  // 전원이 같은 그룹이면 그 값을 보여주고, 섞여 있으면 빈 값(= 안내 문구)을 보여준다.
  const groupIds = new Set(tables.map((t) => t.groupId))
  const commonGroup = groupIds.size === 1 ? [...groupIds][0] : undefined

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      {/*
        선택 **개수**를 읽어 주는 유일한 자리다. 사이드바 항목의 `aria-pressed`는 "이것이
        선택됐다"만 말하고 총합은 말하지 못한다. `role`을 덮어쓰지 않으려고 `aria-live`만 건다 —
        h2의 heading 역할을 status로 바꾸면 제목 탐색에서 사라진다.
        ⚠️ 한계: 이 패널은 2개 이상일 때 새로 마운트되므로 1→2 전환은 "리전 안의 내용 변경"이
        아니라 리전 자체의 삽입이라 낭독이 보장되지 않는다. 2→3처럼 이미 떠 있는 동안의 변경은 읽힌다.
      */}
      <h2 aria-live="polite" className="mb-3 text-sm font-semibold">{formatCount(ids.length)}개 테이블 선택됨</h2>

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

      {/*
        드롭다운은 **있는 그룹으로 옮기고**, 이 버튼은 **새 그룹을 만들어** 선택 전원을 담는다.
        만든 직후 `selectGroup`이 우측을 그룹 패널로 바꾸므로 이름·색을 그 자리에서 고친다
        (그 액션이 선택을 비우는 것은 의도다 — 패널은 둘 중 하나만 그린다).
      */}
      <Button variant="outline" className="mb-4 w-full" disabled={!canEdit}
        onClick={() => {
          const id = createGroupWith(mutate, ids)
          if (id !== null) selectGroup(id)
        }}>선택 테이블로 새 그룹</Button>

      <Button variant="destructive" className="w-full" disabled={!canEdit}
        onClick={() => setConfirming(true)}>선택 테이블 삭제</Button>

      <BulkDeleteDialog projectId={projectId} ids={ids} open={confirming} onOpenChange={setConfirming} />
    </aside>
  )
}
