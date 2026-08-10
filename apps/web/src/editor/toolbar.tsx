import { FileText, LayoutGrid, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { setTableGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation, useUndoRedo } from './use-model.js'
import { newId } from './uid.js'
import { addTable, moveTable, moveTableGroupPosition, removeTable } from './model-edits.js'
import { addNote } from './note-edits.js'
import { computeAutoLayout } from './auto-layout.js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function Toolbar({ projectId }: { projectId: string }) {
  const canEdit = useEditorStore((s) => s.canEdit)
  const mutate = useModelMutation(projectId)
  const { undo, redo, canUndo, canRedo } = useUndoRedo(projectId)
  const model = useEditorStore((s) => s.model)
  const selectedTableIds = useEditorStore((s) => s.selectedTableIds)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const select = useEditorStore((s) => s.select)
  const selectNote = useEditorStore((s) => s.selectNote)
  const rf = useReactFlow()
  const visibleTables = Object.values(model.tables).filter((t) => (activeGroupView ? t.groupId === activeGroupView : true))

  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) void redo()
      else void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, canEdit])

  const onAdd = () => {
    const id = newId()
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const agv = activeGroupView
    void mutate((m) => {
      let n = addTable(m, { id, position: center })
      if (agv) n = setTableGroup(n, id, agv)
      return n
    }, { summary: '테이블 추가' })
    select(id)
  }
  const onDelete = () => {
    const id = selectedTableIds[0]
    if (!id) return
    select(null)
    void mutate((m) => removeTable(m, id), { summary: '테이블 삭제' })
  }
  const onAddNote = () => {
    const id = newId()
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    void mutate((m) => addNote(m, { id, position: center }), { summary: '메모 추가' })
    selectNote(id)
  }
  const onAutoLayout = () => {
    const agv = activeGroupView
    if (visibleTables.length < 2) return
    const ids = new Set(visibleTables.map((t) => t.id))
    const nodes = visibleTables.map((t) => {
      const n = rf.getNode(t.id)
      return { id: t.id, width: n?.measured?.width ?? 260, height: n?.measured?.height ?? 120 }
    })
    const edges = Object.values(model.relationships)
      .filter((r) => ids.has(r.parentTableId) && ids.has(r.childTableId))
      .map((r) => ({ source: r.parentTableId, target: r.childTableId }))
    const pos = computeAutoLayout(nodes, edges)
    void mutate((m) => {
      let n = m
      for (const [id, p] of pos) n = agv ? moveTableGroupPosition(n, id, p) : moveTable(n, id, p)
      return n
    }, { summary: '자동 정렬' })
  }

  if (!canEdit) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary">읽기 전용</Badge>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAdd}><Plus /> 테이블 추가</Button>
      <Button size="sm" variant="outline" disabled={!!activeGroupView} onClick={onAddNote}><FileText /> 메모</Button>
      <Button size="sm" variant="outline" disabled={visibleTables.length < 2} onClick={onAutoLayout}>
        <LayoutGrid /> 자동 정렬
      </Button>
      <Button size="sm" variant="outline" disabled={selectedTableIds.length === 0} onClick={onDelete}>
        <Trash2 /> 삭제
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="icon" variant="ghost" className="size-8" disabled={!canUndo} aria-label="실행 취소" onClick={() => void undo()}>
        <Undo2 className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" disabled={!canRedo} aria-label="다시 실행" onClick={() => void redo()}>
        <Redo2 className="size-4" />
      </Button>
    </div>
  )
}
