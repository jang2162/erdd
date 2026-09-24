import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { FolderPlus } from 'lucide-react'
import type { Table } from '@erdd/core'
import { primaryTableId, useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { createGroupWith } from './group-edits.js'
import { applyGroupMove } from './bulk-panel.js'
import { useDragStore } from './drag-store.js'
import { dropAttrValue, dropTargetAt } from './drop-target.js'
import { Input } from '@/components/ui/input'
import { formatCount } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function TableTree({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const primaryId = useEditorStore(primaryTableId)
  const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const focus = useEditorStore((s) => s.focus)
  const toggleTable = useEditorStore((s) => s.toggleTable)
  const selectTables = useEditorStore((s) => s.selectTables)
  const selectGroup = useEditorStore((s) => s.selectGroup)
  const dragTableIds = useDragStore((s) => s.tableIds)
  const dragOver = useDragStore((s) => s.over)
  const dragStart = useDragStore((s) => s.start)
  const dragEnd = useDragStore((s) => s.end)
  const mutate = useModelMutation(projectId)
  const [q, setQ] = useState('')
  /**
   * Shift 범위의 **시작점**. 주 선택(`primaryTableId` = 선택 배열의 마지막)과는 다른 개념이다 —
   * 범위를 아래로 넓히면 마지막 원소는 "내가 클릭한 것"이 아니라 범위의 아래쪽 끝이 되므로,
   * 주 선택을 앵커로 재사용하면 아래로 늘릴 때만 앵커가 범위를 따라 끌려간다.
   * 화면 조작의 임시 상태라 store가 아니라 여기 둔다(실시간·캔버스·패널 어디서도 읽지 않는다).
   */
  const [anchorId, setAnchorId] = useState<string | null>(null)

  const query = q.trim().toLowerCase()
  const dragging = dragTableIds.length > 0
  const dragOverGroupId = dragging ? dragOver?.groupId : undefined

  const allTables = useMemo(() => {
    const match = (t: { physicalName: string; logicalName: string }) =>
      query === '' || t.physicalName.toLowerCase().includes(query) || t.logicalName.toLowerCase().includes(query)
    return Object.values(model.tables).filter(match)
      .sort((a, b) => a.physicalName.localeCompare(b.physicalName))
  }, [model.tables, query])
  const groups = useMemo(
    () => Object.values(model.tableGroups).sort((a, b) => a.name.localeCompare(b.name)),
    [model.tableGroups])

  // 그룹 멤버 목록은 표시와 범위 계산이 **같은 목록**이어야 한다 — 둘이 갈리면 화면에 없는
  // 테이블이 Shift 범위에 끌려 들어온다. 그룹마다 전체 테이블을 훑으면 그 스캔이
  // O(그룹수 × 테이블수)로 두 번(렌더 + orderedIds) 도므로, 한 번에 갈라 두 곳이 나눠 쓴다.
  const { membersByGroup, unassigned } = useMemo(() => {
    const byGroup = new Map<string, Table[]>(groups.map((g) => [g.id, []]))
    const rest: Table[] = []
    for (const t of allTables) {
      const bucket = t.groupId !== null ? byGroup.get(t.groupId) : undefined
      if (bucket) bucket.push(t)
      else rest.push(t)   // groupId가 null이거나 이미 사라진 그룹을 가리킨다
    }
    return { membersByGroup: byGroup, unassigned: rest }
  }, [allTables, groups])
  const membersOf = (groupId: string): Table[] => membersByGroup.get(groupId) ?? []

  // 유효 활성 그룹: 설정됐고 실제로 존재할 때만 스코핑한다(삭제된 경우 전체 뷰로 폴백 — canvas와 일치).
  // 드래그 중에는 스코핑을 푼다 — 그룹 뷰에서 "이건 다른 그룹으로 보내야겠다"가 막히면 안 된다(설계 5.5).
  const scopedGroupId = !dragging && activeGroupView && model.tableGroups[activeGroupView]
    ? activeGroupView : null
  const visibleGroups = scopedGroupId ? groups.filter((g) => g.id === scopedGroupId) : groups
  // 드래그 중 미분류를 여는 것은 `scopedGroupId`의 `!dragging`이 이미 한다 — 드래그 중에는
  // 스코핑이 풀리고, 그룹이 하나라도 있으면 아래 둘째 절이 참이 된다.
  const showUnassigned = !scopedGroupId && (unassigned.length > 0 || groups.length > 0)

  // Shift 범위 선택의 기준 = **화면에 보이는 순서**. 검색으로 걸러졌거나 그룹 뷰 밖인 항목은 여기 없다.
  const orderedIds = [
    ...visibleGroups.flatMap((g) => membersOf(g.id).map((t) => t.id)),
    ...(showUnassigned ? unassigned.map((t) => t.id) : []),
  ]
  const selectedIds = new Set(selectedTableIds)

  /**
   * 범위의 시작 인덱스. 앵커가 쓸 수 없으면(검색·그룹 뷰로 화면에서 사라졌거나, 캔버스가
   * 선택을 갈아치워 앵커가 더 이상 선택의 일부가 아니면) 주 선택으로 폴백한다.
   */
  const rangeStart = (): number => {
    if (anchorId !== null && selectedIds.has(anchorId)) {
      const a = orderedIds.indexOf(anchorId)
      if (a !== -1) return a
    }
    return primaryId !== null ? orderedIds.indexOf(primaryId) : -1
  }

  // 선택은 뷰 상태이지 모델 변경이 아니다 — canEdit과 무관하게 Viewer도 고를 수 있다.
  const onItemClick = (e: ReactMouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey) { setAnchorId(id); toggleTable(id); return }
    // Shift+클릭은 앵커를 옮기지 않는다 — 한 칸씩 넓혀 조준하려면 시작점이 고정돼야 한다.
    if (e.shiftKey) {
      const a = rangeStart()
      const b = orderedIds.indexOf(id)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        selectTables(orderedIds.slice(lo, hi + 1))
        return
      }
    }
    // 수식키가 없거나 앵커·주 선택 어느 쪽도 화면에 없으면 기존 동작: 단일 선택 + 캔버스 포커스.
    setAnchorId(id)
    focus(id)
  }

  /**
   * 잡은 항목이 현재 선택에 있으면 **선택 전체**를, 아니면 그 항목 하나를 끈다(파일 탐색기 관례).
   * 후자에서는 선택도 그 항목으로 바꾼다 — 끌고 있는 것과 강조된 것이 갈리면 안 된다.
   */
  const onDragStartItem = (id: string) => {
    const ids = selectedIds.has(id) ? selectedTableIds : [id]
    if (!selectedIds.has(id)) selectTables([id])
    dragStart(ids, 'sidebar')
  }

  const onDropItem = () => {
    const { tableIds, over } = useDragStore.getState()
    dragEnd()
    // `over === null`(어떤 드롭 타깃 위도 아님)과 `{groupId: null}`(미분류 위)은 다른 상태다.
    if (over === null) return
    // 무엇을 옮길지·옮겨도 되는지는 전부 applyGroupMove가 정한다. 여기서 한 번 더 거르면
    // 일괄 패널과 규칙이 갈려 같은 의도가 진입점에 따라 다른 좌표로 끝난다.
    applyGroupMove(mutate, tableIds, over.groupId)
  }

  const onAddGroup = () => {
    // 새 그룹 하나 만들기의 규칙은 createGroupWith 한 곳에 있다 — 우측 일괄 패널의
    // 「선택 테이블로 새 그룹」과 같은 함수다. 여기서는 멤버 없이 만든다.
    const id = createGroupWith(mutate, [])
    if (id !== null) selectGroup(id)
  }

  const totalTables = Object.keys(model.tables).length

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-1 border-b p-2">
        <Input placeholder="테이블 검색" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
        {canEdit && (
          <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="그룹 추가" onClick={onAddGroup}>
            <FolderPlus className="size-4" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {visibleGroups.map((g) => {
          const members = membersOf(g.id)
          // 드래그 중이면 멤버가 검색에 걸리지 않는 그룹도 남긴다 — 그러지 않으면 검색으로 찾은
          // 테이블을 원하는 그룹에 놓을 수 없다(설계 5.5).
          if (query !== '' && members.length === 0 && !dragging) return null
          return (
            <div key={g.id} data-drop-group={dropAttrValue(g.id)}
              className={cn('mb-1 rounded', dragOverGroupId === g.id && 'ring-2 ring-primary')}>
              <button type="button" onClick={() => selectGroup(g.id)}
                className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent',
                  g.id === selectedGroupId && 'bg-accent',
                  g.id === scopedGroupId && 'ring-1 ring-inset ring-ring')}>
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: g.color }} />
                <span className="flex-1 truncate text-xs font-semibold">{g.name}</span>
                <span className="text-[10px] text-muted-foreground">{formatCount(members.length)}</span>
              </button>
              <ul className="ml-3 border-l pl-1">
                {members.map((t) => (
                  <TableItem key={t.id} t={t} selected={selectedIds.has(t.id)} draggable={canEdit}
                    onClick={(e) => onItemClick(e, t.id)}
                    onDragStart={onDragStartItem} onDrop={onDropItem} />
                ))}
              </ul>
            </div>
          )
        })}

        {showUnassigned && (
          <div data-drop-group={dropAttrValue(null)}
            className={cn('mb-1 rounded', dragging && dragOver?.groupId === null && 'ring-2 ring-primary')}>
            {groups.length > 0 && (
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">미분류</div>
            )}
            <ul className={groups.length > 0 ? 'ml-3 border-l pl-1' : undefined}>
              {unassigned.map((t) => (
                <TableItem key={t.id} t={t} selected={selectedIds.has(t.id)} draggable={canEdit}
                  onClick={(e) => onItemClick(e, t.id)}
                  onDragStart={onDragStartItem} onDrop={onDropItem} />
              ))}
            </ul>
          </div>
        )}

        {allTables.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {totalTables === 0 ? '테이블을 추가해 설계를 시작하세요.' : '검색 결과가 없습니다.'}
          </p>
        )}
      </div>
    </aside>
  )
}

/** 클릭과 드래그를 가르는 이동 거리(px). 이보다 작으면 손떨림으로 보고 클릭으로 남긴다. */
const DRAG_THRESHOLD = 4

function TableItem({ t, selected, draggable, onClick, onDragStart, onDrop }: {
  t: { id: string; physicalName: string; logicalName: string }
  selected: boolean
  /**
   * false면 포인터 로직을 **아예 타지 않는다.** Viewer에게 드래그는 존재하지 않는 기능이므로
   * 시작만 막으면 부족하다 — 임계를 넘겨 끌린 순간 click 억제가 켜져 **선택이 먹지 않는다**.
   * 선택은 뷰 상태라 canEdit과 무관해야 한다(위 onItemClick).
   */
  draggable: boolean
  onClick: (e: ReactMouseEvent) => void
  onDragStart: (id: string) => void
  onDrop: () => void
}) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  return (
    <li>
      <button type="button"
        /*
         * 선택 상태를 보조기술에 노출하는 **유일한 채널**이다. 표시가 `bg-accent` 클래스뿐이면
         * 스크린리더 사용자는 무엇이 선택됐는지 알 방법이 없다 — 단일 선택 시절엔 편집 패널이
         * 대상을 열어 주는 것이 사실상 피드백이었지만, 다중 선택이 1급 조작이 된 지금은 대체
         * 채널이 없다. role은 건드리지 않는다: 항목은 실제 `<button>`이고 Cmd+클릭이 그것을
         * 켜고 끄므로 토글 버튼(`aria-pressed`)이 그대로 맞다. listbox/option으로 바꾸면 로빙
         * tabindex·aria-activedescendant까지 함께 가야 하는데, 그건 이 결함이 요구하는 것보다 훨씬 크다.
         */
        aria-pressed={selected}
        // 드래그로 끝난 pointerup 뒤에는 click이 한 번 더 온다 — 선택이 튀지 않게 억제한다.
        onClick={(e) => { if (!dragging.current) onClick(e) }}
        onPointerDown={(e) => {
          if (!draggable || e.button !== 0) return
          origin.current = { x: e.clientX, y: e.clientY }
          dragging.current = false
          // 캡처가 없으면 커서가 항목 밖으로 나가는 순간 pointermove가 끊긴다.
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const o = origin.current
          if (!o) return
          if (!dragging.current) {
            if (Math.abs(e.clientX - o.x) < DRAG_THRESHOLD && Math.abs(e.clientY - o.y) < DRAG_THRESHOLD) return
            dragging.current = true
            onDragStart(t.id)
          }
          useDragStore.getState().moveOver(dropTargetAt(e.clientX, e.clientY))
        }}
        onPointerUp={(e) => {
          origin.current = null
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
          if (!dragging.current) return
          onDrop()
          // 뒤따라오는 click을 흘려보낸 뒤 억제를 푼다. 지우면 키보드(Enter/Space)로 그 버튼을
          // 활성화해도 무시된다 — click은 pointerdown 없이 온다.
          setTimeout(() => { dragging.current = false }, 0)
        }}
        onPointerCancel={() => {
          // 브라우저가 드래그를 취소하면(터치 세로 팬·컨텍스트 메뉴) pointerup이 오지 않는다.
          // 여기서 풀지 않으면 dragging이 참으로 남아 그룹 뷰 스코핑이 영구히 풀린 채 갇힌다.
          // 취소 뒤에는 click이 오지 않으므로 억제를 미룰 이유도 없다.
          origin.current = null
          if (!dragging.current) return
          dragging.current = false
          useDragStore.getState().end()
        }}
        className={cn('flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent', selected && 'bg-accent')}>
        <span className="font-mono text-xs font-medium">{t.physicalName}</span>
        <span className="text-xs text-muted-foreground">{t.logicalName}</span>
      </button>
    </li>
  )
}
